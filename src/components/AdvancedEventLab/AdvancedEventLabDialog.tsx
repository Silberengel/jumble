import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { isLanguageToolConfigured } from '@/lib/languagetool-client'
import { languageToolLintExtension, LT_GRAMMAR_MARK_CLASS, requestAdvancedLabGrammarLint } from '@/lib/languagetool-cm-linter'
import { pickLanguageToolCodeForTranslateTarget } from '@/lib/languagetool-language-order'
import {
  buildResolvedTranslateMenuLanguageOptions,
  translateLanguageOptionMatchesQuery
} from '@/lib/language-display-meta'
import { LanguageSelectOptionLines } from '@/lib/language-select-option-lines'
import { buildLabLanguageToolPreferenceList } from '@/lib/trinity-languages'
import {
  parseLabSlice,
  serializePublishPreviewLabJson,
  type AdvancedEventLabSlice
} from '@/lib/advanced-event-lab-slice'
import type { TContentWarningDraftOptions } from '@/lib/content-warning'
import { translateAdvancedLabMarkup } from '@/lib/advanced-lab-markup-protect'
import {
  warmTranslateLanguagesOnce,
  isTranslateConfigured,
  translateApiLanguageCode,
  type TranslateLanguageOption
} from '@/lib/translate-client'
import { setReadAloudTranslationForEvent } from '@/lib/read-aloud-translation-override'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { StreamLanguage } from '@codemirror/language'
import { asciidoc } from 'codemirror-asciidoc'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder
} from '@codemirror/view'
import { Undo2 } from 'lucide-react'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdvancedEventLabMarkupToolbar } from './AdvancedEventLabMarkupToolbar'
import { AdvancedEventLabPreviewPane } from './AdvancedEventLabPreviewPane'
import AdvancedEventLabTagsEditor, {
  editableRowsToLabTags,
  labTagsToEditableRows
} from './AdvancedEventLabTagsEditor'
import { newComposerTagRow, type ComposerExtraTagRow } from '@/lib/composer-extra-tags'
import { stripImwaldAttributionTags } from '@/lib/draft-event'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import type { TEmoji } from '@/types'

const PREVIEW_DEBOUNCE_MS = 200

const LAB_UNDO_STORAGE_V = 1 as const
const LAB_UNDO_INTERVAL_MS = 30_000
const LAB_UNDO_MAX_CHECKPOINTS = 10

function labUndoSessionStorageKey(storageId: string): string {
  return `jumble:advLabUndo:${storageId}`
}

function cloneLabSlice(s: AdvancedEventLabSlice): AdvancedEventLabSlice {
  return { kind: s.kind, content: s.content, tags: s.tags.map((row) => [...row]) }
}

function labSlicesEqual(a: AdvancedEventLabSlice, b: AdvancedEventLabSlice): boolean {
  if (a.kind !== b.kind || a.content !== b.content) return false
  return JSON.stringify(a.tags) === JSON.stringify(b.tags)
}

function parseCheckpointEntry(raw: unknown): AdvancedEventLabSlice | null {
  let json: string
  try {
    json = JSON.stringify(raw)
  } catch {
    return null
  }
  const parsed = parseLabSlice(json)
  return parsed.ok ? parsed.value : null
}

function loadLabCheckpointsFromSession(
  storageId: string,
  base: AdvancedEventLabSlice
): AdvancedEventLabSlice[] | null {
  if (!storageId || typeof sessionStorage === 'undefined') return null
  try {
    const key = labUndoSessionStorageKey(storageId)
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const o = JSON.parse(raw) as { v?: number; checkpoints?: unknown }
    if (!o || o.v !== LAB_UNDO_STORAGE_V || !Array.isArray(o.checkpoints)) return null
    const out: AdvancedEventLabSlice[] = []
    for (const row of o.checkpoints) {
      const slice = parseCheckpointEntry(row)
      if (!slice) return null
      out.push(slice)
    }
    if (out.length === 0) return null
    const last = out[out.length - 1]!
    if (!labSlicesEqual(last, base)) return null
    return out.slice(0, LAB_UNDO_MAX_CHECKPOINTS).map(cloneLabSlice)
  } catch {
    return null
  }
}

function persistLabCheckpointsToSession(storageId: string, checkpoints: AdvancedEventLabSlice[]): void {
  if (!storageId || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      labUndoSessionStorageKey(storageId),
      JSON.stringify({ v: LAB_UNDO_STORAGE_V, checkpoints })
    )
  } catch {
    // quota / private mode
  }
}

function clearLabCheckpointsSession(storageId: string): void {
  if (!storageId || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(labUndoSessionStorageKey(storageId))
  } catch {
    /* ignore */
  }
}

/** Subset of {@link TPostTextareaHandle} so media upload + toolbar can target the lab surface. */
export type AdvancedLabBodyHandle = {
  getText: () => string
  insertText: (text: string) => void
  appendText: (text: string, addNewline?: boolean) => void
  insertEmoji: (emoji: string | TEmoji) => void
}

function cmInsertAtSelection(view: EditorView, text: string) {
  const sel = view.state.selection.main
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: EditorSelection.cursor(sel.from + text.length)
  })
  view.focus()
}

function cmAppendAtEnd(view: EditorView, text: string, addNewline = false) {
  const doc = view.state.doc
  const at = doc.length
  const prefix = addNewline && doc.length > 0 ? '\n' : ''
  const insert = prefix + text
  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: EditorSelection.cursor(at + insert.length)
  })
  view.focus()
}

export type AdvancedEventLabDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Snapshot when opening; parent should memoize. */
  initial: AdvancedEventLabSlice | null
  /** When false, Apply keeps `initial.kind`. */
  kindEditable?: boolean
  markupMode: 'markdown' | 'asciidoc'
  /** `i18n.language` for LanguageTool default ordering. */
  i18nLanguage?: string
  /** When set, user can store translation for read-aloud for this event id. */
  contextEventId?: string | null
  onApply: (payload: AdvancedEventLabSlice) => void
  /** Filled while the markup editor is mounted (for uploads / shared toolbar). */
  bodyApiRef?: MutableRefObject<AdvancedLabBodyHandle | null>
  /** Same icon row as the main composer; should use {@link bodyApiRef} for inserts. */
  renderFormatToolbar?: (ctx: {
    /** Portal target inside this dialog so pickers stay interactive above the lab shell. */
    pickerPortalContainer: HTMLElement | null
    toolbarOrientation?: 'horizontal' | 'vertical'
  }) => ReactNode
  /** Settings / advanced composer options panel (shown below {@link renderFormatToolbar}). */
  composerToolbarPanel?: ReactNode
  /**
   * When set, lab markup/tags are debounced to the post-editor draft store (same persistence as TipTap)
   * so a **reload** can restore in-progress lab work. The draft is kept on dismiss; clear happens on publish or composer Clear.
   */
  draftPersistenceKey?: string | null
  /** Lab preview: resolve custom `:shortcode:` from this author's NIP-30 inventory when tags do not define them. */
  previewAuthorPubkey?: string | null
  /** Lab preview: `emoji` tags on the fake event (e.g. copied from the event being edited). */
  previewEmojiTags?: string[][]
  /** When true (default), JSON preview includes the Imwald `client` tag like publish. */
  addClientTag?: boolean
  /** Composer Advanced panel content-warning settings (merged into JSON preview). */
  contentWarning?: TContentWarningDraftOptions
  /** When set (reply/post composer), portal into the parent dialog layer so Radix does not mark this inert. */
  portalContainer?: HTMLElement | null
  /** Solid full-viewport backdrop when portaled (hides the composer underneath). */
  portalBackdrop?: boolean
}

function useDarkModeFlag(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => {
      setDark(el.classList.contains('dark'))
    })
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export default function AdvancedEventLabDialog({
  open,
  onOpenChange,
  initial,
  kindEditable = true,
  markupMode,
  i18nLanguage,
  contextEventId,
  onApply,
  bodyApiRef,
  renderFormatToolbar,
  composerToolbarPanel,
  draftPersistenceKey = null,
  previewAuthorPubkey = null,
  previewEmojiTags,
  addClientTag = true,
  contentWarning,
  portalContainer = null,
  portalBackdrop = false
}: AdvancedEventLabDialogProps) {
  const { t, i18n } = useTranslation()
  const [labPickerPortalContainer, setLabPickerPortalContainer] = useState<HTMLElement | null>(null)
  /** `useTranslation().t` can change identity every render; never list it as a layout-effect dep (editor remount loop). */
  const labTRef = useRef(t)
  labTRef.current = t
  const dark = useDarkModeFlag()
  const markupHost = useRef<HTMLDivElement>(null)
  const markupView = useRef<EditorView | null>(null)
  const sliceRef = useRef<AdvancedEventLabSlice | null>(null)
  const draftPersistenceKeyRef = useRef<string | null>(null)
  const labUndoAnonIdRef = useRef<string | null>(null)
  const labCheckpointsRef = useRef<AdvancedEventLabSlice[]>([])
  const [undoUiTick, setUndoUiTick] = useState(0)
  const labPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedulePreviewUpdateRef = useRef<(text: string) => void>(() => {})
  /** Debounce writes to the draft map; pagehide/beforeunload flush immediately to disk. */
  const LAB_DRAFT_DEBOUNCE_MS = 500

  const [previewDoc, setPreviewDoc] = useState('')
  const [labBodyTab, setLabBodyTab] = useState<'edit' | 'preview' | 'json'>('edit')
  const labBodyTabRef = useRef(labBodyTab)
  labBodyTabRef.current = labBodyTab
  const [labJsonPreview, setLabJsonPreview] = useState('')
  const refreshLabJsonPreviewRef = useRef<() => void>(() => {})
  const [labTagRows, setLabTagRows] = useState<ComposerExtraTagRow[]>(() => [newComposerTagRow()])

  /** Stable while payload matches; avoids remounting the editor when the parent passes a new `initial` object reference. */
  const labEditorMountFingerprint =
    initial != null ? `${initial.kind}\0${initial.content}\0${JSON.stringify(initial.tags)}` : ''

  const mergedLabPreviewEmojiTags = useMemo(() => {
    if (!open || !initial) return []
    const fromInitial = initial.tags.filter(([n]) => n === 'emoji').map((r) => [...r])
    const fromProp = previewEmojiTags ?? []
    const m = new Map<string, string[]>()
    for (const row of fromInitial) {
      const sc = row[1]?.trim()
      if (sc) m.set(sc.toLowerCase(), row)
    }
    for (const row of fromProp) {
      const sc = row[1]?.trim()
      if (sc) m.set(sc.toLowerCase(), row)
    }
    return [...m.values()]
  }, [open, initial, previewEmojiTags])

  const schedulePreviewUpdate = useCallback((text: string) => {
    if (previewDebounceTimerRef.current) {
      clearTimeout(previewDebounceTimerRef.current)
    }
    previewDebounceTimerRef.current = setTimeout(() => {
      previewDebounceTimerRef.current = null
      setPreviewDoc(text)
    }, PREVIEW_DEBOUNCE_MS)
  }, [])

  const flushPreviewDocNow = useCallback(() => {
    if (previewDebounceTimerRef.current) {
      clearTimeout(previewDebounceTimerRef.current)
      previewDebounceTimerRef.current = null
    }
    const doc = markupView.current?.state.doc.toString() ?? sliceRef.current?.content ?? ''
    setPreviewDoc(doc)
  }, [])

  const refreshLabJsonPreview = useCallback(() => {
    const s = sliceRef.current
    if (!s) {
      setLabJsonPreview('{}')
      return
    }
    const content = markupView.current?.state.doc.toString() ?? s.content
    const kind = kindEditable ? s.kind : (initial?.kind ?? s.kind)
    setLabJsonPreview(
      serializePublishPreviewLabJson(
        {
          kind,
          content,
          tags: editableRowsToLabTags(labTagRows)
        },
        { addClientTag, contentWarning }
      )
    )
  }, [kindEditable, initial, labTagRows, addClientTag, contentWarning])

  useEffect(() => {
    refreshLabJsonPreviewRef.current = refreshLabJsonPreview
  }, [refreshLabJsonPreview])

  useEffect(() => {
    schedulePreviewUpdateRef.current = schedulePreviewUpdate
  }, [schedulePreviewUpdate])

  draftPersistenceKeyRef.current = draftPersistenceKey ?? null

  useEffect(() => {
    if (!open) labUndoAnonIdRef.current = null
  }, [open])

  const undoSessionId = useMemo(() => {
    if (!open) return ''
    if (draftPersistenceKey) return draftPersistenceKey
    if (!labUndoAnonIdRef.current) labUndoAnonIdRef.current = crypto.randomUUID()
    return labUndoAnonIdRef.current
  }, [open, draftPersistenceKey])

  const bumpUndoUi = useCallback(() => {
    setUndoUiTick((n) => n + 1)
  }, [])

  /** Writes the live CodeMirror doc into the draft cache. `urgent` flushes localStorage synchronously (tab hide / unload only). */
  const flushLabDraftNow = useCallback((key: string, urgent = false) => {
    const v = markupView.current
    const s = sliceRef.current
    if (!v || !s) return
    if (labPersistTimerRef.current) {
      clearTimeout(labPersistTimerRef.current)
      labPersistTimerRef.current = null
    }
    postEditorCache.setAdvancedLabDraft(key, {
      kind: s.kind,
      content: v.state.doc.toString(),
      tags: s.tags.map((row) => [...row])
    })
    if (urgent) postEditorCache.flushPersist()
  }, [])

  useEffect(() => {
    if (!open || !draftPersistenceKey) return
    const key = draftPersistenceKey
    const onPageLeave = () => {
      flushLabDraftNow(key, true)
    }
    window.addEventListener('pagehide', onPageLeave)
    window.addEventListener('beforeunload', onPageLeave)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onPageLeave()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageLeave)
      window.removeEventListener('beforeunload', onPageLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [open, draftPersistenceKey, flushLabDraftNow])

  useEffect(() => {
    if (!open) {
      if (previewDebounceTimerRef.current) {
        clearTimeout(previewDebounceTimerRef.current)
        previewDebounceTimerRef.current = null
      }
      setPreviewDoc('')
      setLabJsonPreview('')
    } else {
      setLabBodyTab('edit')
    }
  }, [open])

  useEffect(() => {
    if (!open || labBodyTab !== 'json') return
    refreshLabJsonPreview()
  }, [open, labBodyTab, labTagRows, refreshLabJsonPreview])

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        const key = draftPersistenceKeyRef.current
        if (key) {
          flushLabDraftNow(key, true)
        }
      }
      onOpenChange(next)
    },
    [onOpenChange, flushLabDraftNow]
  )

  const scheduleLabDraftPersist = useCallback(() => {
    const key = draftPersistenceKeyRef.current
    if (!key) return
    if (labPersistTimerRef.current) {
      clearTimeout(labPersistTimerRef.current)
    }
    labPersistTimerRef.current = setTimeout(() => {
      labPersistTimerRef.current = null
      const v = markupView.current
      const s = sliceRef.current
      if (!s) return
      const content = v?.state.doc.toString() ?? s.content
      postEditorCache.setAdvancedLabDraft(key, {
        kind: s.kind,
        content,
        tags: s.tags.map((row) => [...row])
      })
    }, LAB_DRAFT_DEBOUNCE_MS)
  }, [])

  const syncLabTagsFromRows = useCallback(
    (rows: ComposerExtraTagRow[]) => {
      setLabTagRows(rows)
      const s = sliceRef.current
      if (!s) return
      s.tags = editableRowsToLabTags(rows)
      scheduleLabDraftPersist()
      bumpUndoUi()
      if (labBodyTabRef.current === 'json') refreshLabJsonPreviewRef.current()
    },
    [scheduleLabDraftPersist, bumpUndoUi]
  )

  const restoreSliceInEditor = useCallback(
    (slice: AdvancedEventLabSlice) => {
      const v = markupView.current
      if (!v) return
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: slice.content },
        selection: EditorSelection.cursor(0)
      })
      const editable = stripImwaldAttributionTags(slice.tags)
      sliceRef.current = {
        kind: slice.kind,
        content: slice.content,
        tags: editable.map((row) => [...row])
      }
      setLabTagRows(labTagsToEditableRows(editable))
      setPreviewDoc(slice.content)
      scheduleLabDraftPersist()
      if (isLanguageToolConfigured()) requestAdvancedLabGrammarLint(v)
      bumpUndoUi()
    },
    [bumpUndoUi, scheduleLabDraftPersist]
  )

  const pushLabCheckpoint = useCallback(() => {
    const v = markupView.current
    const s = sliceRef.current
    if (!v || !s || !undoSessionId) return
    const snap = cloneLabSlice({
      kind: s.kind,
      content: v.state.doc.toString(),
      tags: s.tags.map((row) => [...row])
    })
    const cp = labCheckpointsRef.current
    const last = cp[cp.length - 1]
    if (last && labSlicesEqual(last, snap)) return
    cp.push(snap)
    while (cp.length > LAB_UNDO_MAX_CHECKPOINTS) cp.shift()
    persistLabCheckpointsToSession(undoSessionId, cp)
    bumpUndoUi()
  }, [undoSessionId, bumpUndoUi])

  const handleUndoCheckpoint = useCallback(() => {
    const v = markupView.current
    const s = sliceRef.current
    if (!v || !s || !undoSessionId) return
    const cp = labCheckpointsRef.current
    if (cp.length === 0) {
      toast.message(t('Advanced lab undo checkpoint none'))
      return
    }
    const live = cloneLabSlice({
      kind: s.kind,
      content: v.state.doc.toString(),
      tags: s.tags.map((row) => [...row])
    })
    const last = cp[cp.length - 1]!
    if (!labSlicesEqual(live, last)) {
      restoreSliceInEditor(last)
      persistLabCheckpointsToSession(undoSessionId, cp)
      toast.success(t('Advanced lab undo checkpoint restored'))
      return
    }
    if (cp.length < 2) {
      toast.message(t('Advanced lab undo checkpoint none'))
      return
    }
    cp.pop()
    const target = cp[cp.length - 1]!
    restoreSliceInEditor(target)
    persistLabCheckpointsToSession(undoSessionId, cp)
    toast.success(t('Advanced lab undo checkpoint restored'))
  }, [undoSessionId, restoreSliceInEditor, t])

  const canUndoCheckpoint = useMemo(() => {
    if (!open) return false
    const v = markupView.current
    const s = sliceRef.current
    const cp = labCheckpointsRef.current
    if (!v || !s || cp.length === 0) return false
    const live: AdvancedEventLabSlice = {
      kind: s.kind,
      content: v.state.doc.toString(),
      tags: s.tags.map((row) => [...row])
    }
    const last = cp[cp.length - 1]!
    if (!labSlicesEqual(live, last)) return true
    return cp.length >= 2
  }, [undoUiTick, open, previewDoc])

  useEffect(() => {
    if (!open || !initial) return
    const pushId = window.setInterval(() => {
      pushLabCheckpoint()
    }, LAB_UNDO_INTERVAL_MS)
    const uiId = window.setInterval(() => {
      bumpUndoUi()
    }, 2500)
    return () => {
      clearInterval(pushId)
      clearInterval(uiId)
    }
  }, [open, labEditorMountFingerprint, pushLabCheckpoint, bumpUndoUi])

  const [translateLangs, setTranslateLangs] = useState<TranslateLanguageOption[]>([])
  const ltList = useMemo(
    () => buildLabLanguageToolPreferenceList(i18nLanguage ?? i18n.language, translateLangs),
    [i18nLanguage, i18n.language, translateLangs]
  )
  const [ltLang, setLtLang] = useState(() => ltList[0] ?? 'en-US')
  const ltLangRef = useRef(ltLang)
  ltLangRef.current = ltLang
  const [translateLoad, setTranslateLoad] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [translateSource, setTranslateSource] = useState('auto')
  const [translateTarget, setTranslateTarget] = useState('en')
  const [ltLangFilter, setLtLangFilter] = useState('')
  const [translateSrcFilter, setTranslateSrcFilter] = useState('')
  const [translateTgtFilter, setTranslateTgtFilter] = useState('')

  const ltListFiltered = useMemo(() => {
    const f = ltList.filter((code) => translateLanguageOptionMatchesQuery(code, ltLangFilter))
    return f.length > 0 ? f : ltList
  }, [ltList, ltLangFilter])
  const translateLangsFilteredSrc = useMemo(() => {
    const f = translateLangs.filter((l) => translateLanguageOptionMatchesQuery(l.code, translateSrcFilter))
    return f.length > 0 ? f : translateLangs
  }, [translateLangs, translateSrcFilter])
  const translateLangsFilteredTgt = useMemo(() => {
    const f = translateLangs.filter((l) => translateLanguageOptionMatchesQuery(l.code, translateTgtFilter))
    return f.length > 0 ? f : translateLangs
  }, [translateLangs, translateTgtFilter])
  const showTranslateSourceAuto = useMemo(() => {
    const q = translateSrcFilter.trim().toLowerCase()
    if (!q) return true
    if (translateSource === 'auto') return true
    const autoLabel = t('Advanced lab translation source auto').toLowerCase()
    return q.includes('auto') || q.includes('detect') || autoLabel.includes(q)
  }, [translateSrcFilter, translateSource, t])

  useEffect(() => {
    if (!open) {
      setLtLangFilter('')
      setTranslateSrcFilter('')
      setTranslateTgtFilter('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setLtLang((prev) => (ltList.includes(prev) ? prev : ltList[0] ?? 'en-US'))
  }, [open, ltList])

  useEffect(() => {
    const v = markupView.current
    if (!v || !open || !isLanguageToolConfigured()) return
    requestAdvancedLabGrammarLint(v)
  }, [ltLang, open])

  useEffect(() => {
    if (!open || !isTranslateConfigured()) {
      setTranslateLangs([])
      setTranslateLoad('idle')
      return
    }
    let cancelled = false
    setTranslateLoad('loading')
    void warmTranslateLanguagesOnce()
      .then((list) => {
        if (cancelled) return
        const resolved = buildResolvedTranslateMenuLanguageOptions(list)
        if (!resolved.length) {
          setTranslateLangs([])
          setTranslateLoad('empty')
          return
        }
        setTranslateLangs([...resolved])
        setTranslateSource('auto')
        const codes = resolved.map((l: TranslateLanguageOption) => l.code)
        const tgt = codes.includes('en') ? 'en' : codes[0]!
        setTranslateTarget(tgt)
        setTranslateLoad('ready')
      })
      .catch(() => {
        if (cancelled) return
        const resolved = buildResolvedTranslateMenuLanguageOptions([])
        setTranslateLangs([...resolved])
        setTranslateSource('auto')
        const codes = resolved.map((l: TranslateLanguageOption) => l.code)
        setTranslateTarget(codes.includes('en') ? 'en' : codes[0]!)
        setTranslateLoad('ready')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const destroyEditors = useCallback(() => {
    if (bodyApiRef) bodyApiRef.current = null
    markupView.current?.destroy()
    markupView.current = null
  }, [bodyApiRef])

  useLayoutEffect(() => {
    if (!open || !initial) {
      destroyEditors()
      return
    }

    let cancelled = false
    let rafId = 0
    let attempts = 0
    const MAX_RAF_ATTEMPTS = 120

    const mountEditors = () => {
      if (cancelled) return
      const mkEl = markupHost.current
      if (!mkEl) {
        attempts += 1
        if (attempts < MAX_RAF_ATTEMPTS) {
          rafId = requestAnimationFrame(mountEditors)
        }
        return
      }

      destroyEditors()

      const editableTags = stripImwaldAttributionTags(initial.tags)
      const baseSlice: AdvancedEventLabSlice = {
        kind: initial.kind,
        content: initial.content,
        tags: editableTags.map((row) => [...row])
      }
      sliceRef.current = baseSlice
      setLabTagRows(labTagsToEditableRows(editableTags))
      setPreviewDoc(baseSlice.content)

      const markupLang: Extension =
        markupMode === 'asciidoc' ? StreamLanguage.define(asciidoc) : markdown()

      const mkExtensions: Extension[] = [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        lineNumbers(),
        cmPlaceholder(
          labTRef.current(
            markupMode === 'asciidoc'
              ? 'Advanced lab markup placeholder asciidoc'
              : 'Advanced lab markup placeholder markdown'
          )
        ),
        markupLang,
        EditorView.theme({
          '&': { height: '100%', maxHeight: '100%', minHeight: 0 },
          '.cm-scroller': { overflow: 'auto', minHeight: 0 },
          // Large dvh mins fight stacked flex/grid rows and overflow onto the preview; host + row cap height instead.
          '.cm-content': {
            minHeight: '12rem',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)'
          },
          // LanguageTool hits: subtle wavy underline (default CM lint SVG is hidden).
          [`.cm-lintRange.${LT_GRAMMAR_MARK_CLASS}`]: {
            backgroundImage: 'none',
            paddingBottom: '1px',
            textDecoration: 'underline',
            textDecorationSkipInk: 'none',
            textDecorationStyle: 'wavy',
            textDecorationColor: 'rgba(234, 88, 12, 0.45)',
            textDecorationThickness: '1.5px',
            textUnderlineOffset: '2px'
          },
          [`.cm-lintRange-active.${LT_GRAMMAR_MARK_CLASS}`]: {
            backgroundColor: 'rgba(234, 88, 12, 0.1)'
          }
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const content = update.state.doc.toString()
          const s = sliceRef.current
          if (!s) return
          s.content = content
          schedulePreviewUpdateRef.current(content)
          scheduleLabDraftPersist()
          if (labBodyTabRef.current === 'json') refreshLabJsonPreviewRef.current()
        })
      ]
      if (isLanguageToolConfigured()) {
        mkExtensions.push(
          languageToolLintExtension(() => ltLangRef.current, 650, () => markupMode)
        )
      }
      if (dark) {
        mkExtensions.push(oneDark)
        mkExtensions.push(
          EditorView.theme({
            [`.cm-lintRange.${LT_GRAMMAR_MARK_CLASS}`]: {
              backgroundImage: 'none',
              paddingBottom: '1px',
              textDecoration: 'underline',
              textDecorationSkipInk: 'none',
              textDecorationStyle: 'wavy',
              textDecorationColor: 'rgba(251, 146, 60, 0.5)',
              textDecorationThickness: '1.5px',
              textUnderlineOffset: '2px'
            },
            [`.cm-lintRange-active.${LT_GRAMMAR_MARK_CLASS}`]: {
              backgroundColor: 'rgba(251, 146, 60, 0.12)'
            }
          })
        )
      }

      const mkState = EditorState.create({
        doc: baseSlice.content,
        extensions: mkExtensions
      })

      markupView.current = new EditorView({ state: mkState, parent: mkEl })

      const loaded =
        undoSessionId && undoSessionId.length > 0
          ? loadLabCheckpointsFromSession(undoSessionId, baseSlice)
          : null
      labCheckpointsRef.current =
        loaded && loaded.length > 0 ? loaded : [cloneLabSlice(baseSlice)]
      if (undoSessionId) {
        persistLabCheckpointsToSession(undoSessionId, labCheckpointsRef.current)
      }
      bumpUndoUi()

      if (bodyApiRef) {
        bodyApiRef.current = {
          getText: () => markupView.current?.state.doc.toString() ?? '',
          insertText: (text: string) => {
            const v = markupView.current
            if (!v) return
            cmInsertAtSelection(v, text)
            const s = sliceRef.current
            if (s) s.content = v.state.doc.toString()
          },
          appendText: (raw: string, addNewline = false) => {
            const v = markupView.current
            if (!v) return
            cmAppendAtEnd(v, raw, addNewline)
            const s = sliceRef.current
            if (s) s.content = v.state.doc.toString()
          },
          insertEmoji: (emoji: string | TEmoji) => {
            const v = markupView.current
            if (!v) return
            let piece: string
            if (typeof emoji === 'string') {
              piece = emoji
            } else {
              const sc = emoji.shortcode?.trim()
              if (sc) {
                piece = `:${sc}: `
              } else {
                const id = customEmojiService.getEmojiId(emoji)
                const ce = customEmojiService.getEmojiById(id)
                piece = ce ? `:${ce.shortcode}: ` : `:${id}: `
              }
            }
            cmInsertAtSelection(v, piece)
            const s = sliceRef.current
            if (s) s.content = v.state.doc.toString()
          }
        }
      }
    }

    mountEditors()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      if (previewDebounceTimerRef.current) {
        clearTimeout(previewDebounceTimerRef.current)
        previewDebounceTimerRef.current = null
      }
      if (labPersistTimerRef.current) {
        clearTimeout(labPersistTimerRef.current)
        labPersistTimerRef.current = null
      }
      const key = draftPersistenceKeyRef.current
      if (key) {
        flushLabDraftNow(key)
      }
      destroyEditors()
    }
  }, [
    open,
    labEditorMountFingerprint,
    markupMode,
    dark,
    destroyEditors,
    bodyApiRef,
    scheduleLabDraftPersist,
    flushLabDraftNow,
    undoSessionId,
    bumpUndoUi
  ])

  const handleApply = () => {
    const s = sliceRef.current
    if (!s) {
      toast.error(t('Advanced lab applyError'))
      return
    }
    const content = markupView.current?.state.doc.toString() ?? s.content
    const kind = kindEditable ? s.kind : (initial?.kind ?? s.kind)
    const payload: AdvancedEventLabSlice = {
      kind,
      content,
      tags: editableRowsToLabTags(labTagRows)
    }
    const key = draftPersistenceKeyRef.current
    if (key) {
      postEditorCache.setAdvancedLabDraft(key, payload)
      postEditorCache.flushPersist()
    }
    onApply(payload)
    if (undoSessionId) {
      clearLabCheckpointsSession(undoSessionId)
      labCheckpointsRef.current = []
    }
    handleDialogOpenChange(false)
  }

  const handleTranslate = async () => {
    if (!isTranslateConfigured()) {
      toast.message(t('Advanced lab translate not configured'))
      return
    }
    const text = markupView.current?.state.doc.toString() ?? sliceRef.current?.content ?? ''
    if (!text.trim()) return
    if (translateLoad !== 'ready' || translateLangs.length === 0) return
    if (
      translateSource !== 'auto' &&
      translateApiLanguageCode(translateSource) === translateApiLanguageCode(translateTarget)
    ) {
      toast.message(t('Advanced lab translation same source target'))
      return
    }
    logger.info('[AdvancedLab] translate button', {
      source: translateSource,
      target: translateTarget,
      inputChars: text.length
    })
    try {
      const out = await translateAdvancedLabMarkup(text, translateTarget, translateSource, markupMode)
      if (!markupView.current) return
      markupView.current.dispatch({
        changes: { from: 0, to: markupView.current.state.doc.length, insert: out }
      })
      const s = sliceRef.current
      if (s) s.content = out
      if (isLanguageToolConfigured()) {
        const nextLt = pickLanguageToolCodeForTranslateTarget(translateTarget, ltList)
        if (nextLt !== ltLang) {
          logger.info('[AdvancedLab] grammar language synced after translate', {
            from: ltLang,
            to: nextLt,
            translateTarget
          })
          setLtLang(nextLt)
        }
      }
      toast.success(t('Advanced lab translate done'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const handleReadAloudBuffer = () => {
    if (!contextEventId) return
    const text = markupView.current?.state.doc.toString().trim() ?? ''
    if (!text) return
    setReadAloudTranslationForEvent(contextEventId, text)
    toast.success(t('Advanced lab read aloud buffer set'))
  }

  const labFormSidebar = (
    <div className="flex flex-col gap-3">
      {renderFormatToolbar ? (
        <div className="rounded-md border border-border bg-muted/20 px-2 py-2">
          {renderFormatToolbar({
            pickerPortalContainer: labPickerPortalContainer,
            toolbarOrientation: 'horizontal'
          })}
        </div>
      ) : null}
      {composerToolbarPanel}
      <AdvancedEventLabTagsEditor rows={labTagRows} onChange={syncLabTagsFromRows} />
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={handleApply}>
          {t('Apply')}
        </Button>
        <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
          {t('Advanced lab cancel undo')}
        </Button>
      </div>
      {isLanguageToolConfigured() ? (
        <div className="space-y-1">
          <Label htmlFor="lt-lang">{t('Advanced lab grammar language')}</Label>
          <Select
            value={ltLang}
            onValueChange={(code) => {
              logger.info('[AdvancedLab] grammar language changed', { from: ltLang, to: code })
              setLtLang(code)
            }}
          >
            <SelectTrigger id="lt-lang" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              className="z-[300] max-h-64 min-w-[var(--radix-select-trigger-width)] p-0"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div
                className="sticky top-0 z-10 border-b border-border bg-popover p-2"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Input
                  type="search"
                  value={ltLangFilter}
                  onChange={(e) => setLtLangFilter(e.target.value)}
                  placeholder={t('Language list filter placeholder')}
                  className="h-8"
                  aria-label={t('Language list filter placeholder')}
                />
              </div>
              <div className="py-1">
                {ltListFiltered.map((code) => (
                  <SelectItem key={code} value={code} className="items-start py-2.5 whitespace-normal">
                    <LanguageSelectOptionLines tag={code} className="w-full" />
                  </SelectItem>
                ))}
              </div>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {isTranslateConfigured() ? (
        <div className="flex flex-col gap-2 min-w-0">
          {translateLoad === 'idle' || translateLoad === 'loading' ? (
            <p className="text-xs text-muted-foreground">{t('Advanced lab translation languages loading')}</p>
          ) : null}
          {translateLoad === 'ready' ? (
            <div className="flex flex-col gap-2">
              <div className="space-y-1">
                <Label htmlFor="tr-src">{t('Advanced lab translation source')}</Label>
                <Select
                  value={translateSource}
                  onValueChange={(v) => {
                    logger.info('[AdvancedLab] translation source language changed', {
                      from: translateSource,
                      to: v
                    })
                    setTranslateSource(v)
                    if (v !== 'auto' && v === translateTarget) {
                      const alt = translateLangs.find((l) => l.code !== v)?.code
                      if (alt) setTranslateTarget(alt)
                    }
                  }}
                >
                  <SelectTrigger id="tr-src" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    className="z-[300] max-h-64 min-w-[var(--radix-select-trigger-width)] p-0"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <div
                      className="sticky top-0 z-10 border-b border-border bg-popover p-2"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Input
                        type="search"
                        value={translateSrcFilter}
                        onChange={(e) => setTranslateSrcFilter(e.target.value)}
                        placeholder={t('Language list filter placeholder')}
                        className="h-8"
                        aria-label={t('Language list filter placeholder')}
                      />
                    </div>
                    <div className="py-1">
                      {showTranslateSourceAuto ? (
                        <SelectItem value="auto">{t('Advanced lab translation source auto')}</SelectItem>
                      ) : null}
                      {translateLangsFilteredSrc.map((l) => (
                        <SelectItem key={l.code} value={l.code} className="items-start py-2.5 whitespace-normal">
                          <LanguageSelectOptionLines tag={l.code} className="w-full" />
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="tr-tgt">{t('Advanced lab translation target')}</Label>
                <Select
                  value={translateTarget}
                  onValueChange={(v) => {
                    logger.info('[AdvancedLab] translation target language changed', {
                      from: translateTarget,
                      to: v
                    })
                    setTranslateTarget(v)
                    if (translateSource !== 'auto' && v === translateSource) {
                      setTranslateSource('auto')
                    }
                  }}
                >
                  <SelectTrigger id="tr-tgt" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    className="z-[300] max-h-64 min-w-[var(--radix-select-trigger-width)] p-0"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <div
                      className="sticky top-0 z-10 border-b border-border bg-popover p-2"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Input
                        type="search"
                        value={translateTgtFilter}
                        onChange={(e) => setTranslateTgtFilter(e.target.value)}
                        placeholder={t('Language list filter placeholder')}
                        className="h-8"
                        aria-label={t('Language list filter placeholder')}
                      />
                    </div>
                    <div className="py-1">
                      {translateLangsFilteredTgt.map((l) => (
                        <SelectItem key={l.code} value={l.code} className="items-start py-2.5 whitespace-normal">
                          <LanguageSelectOptionLines tag={l.code} className="w-full" />
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void handleTranslate()}>
                {t('Advanced lab translate')}
              </Button>
            </div>
          ) : null}
          {translateLoad === 'empty' ? (
            <p className="text-xs text-destructive">{t('Advanced lab translation languages empty')}</p>
          ) : null}
          {translateLoad === 'error' ? (
            <p className="text-xs text-destructive">{t('Advanced lab translation languages error')}</p>
          ) : null}
        </div>
      ) : null}
      {contextEventId && isTranslateConfigured() ? (
        <Button type="button" variant="outline" size="sm" onClick={handleReadAloudBuffer}>
          {t('Advanced lab use translation read aloud')}
        </Button>
      ) : null}
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
      modal={portalBackdrop ? false : !portalContainer}
      registerWithModalManager={!(portalContainer && portalBackdrop)}
    >
      <DialogContent
        portalContainer={portalContainer}
        composerNestedShell={Boolean(portalContainer)}
        hideOverlay={Boolean(portalContainer) && !portalBackdrop}
        overlayClassName={cn(
          portalContainer && 'absolute inset-0 pointer-events-auto',
          portalBackdrop ? 'z-[300] bg-background' : 'z-[300] pointer-events-auto'
        )}
        className={cnDialogShell(Boolean(portalContainer))}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (portalContainer || portalBackdrop) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (portalContainer || portalBackdrop) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          // Lab blocks auto-focus; focus can remain on the composer trigger and Radix would dismiss immediately.
          if (portalContainer || portalBackdrop) e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          if (portalBackdrop) e.preventDefault()
        }}
      >
        <DialogHeader className="shrink-0 border-b px-3 py-2 pr-12 sm:px-4 sm:py-3">
          <DialogTitle>{t('Advanced event lab')}</DialogTitle>
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden md:flex-row">
            <aside className="hidden min-h-0 w-[min(100%,18rem)] shrink-0 flex-col overflow-y-auto overscroll-y-contain border-r bg-muted/10 px-3 py-3 sm:w-72 sm:px-4 lg:w-80 xl:w-96 md:flex">
              {labFormSidebar}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 px-3 pt-2 sm:px-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canUndoCheckpoint}
                    title={t('Advanced lab undo checkpoint hint')}
                    onClick={handleUndoCheckpoint}
                  >
                    <Undo2 className="mr-1 inline h-4 w-4" />
                    {t('Advanced lab undo checkpoint')}
                  </Button>
                </div>
              </div>

              <Tabs
                value={labBodyTab}
                onValueChange={(v) => {
                  const next = v as 'edit' | 'preview' | 'json'
                  if (next === 'preview') flushPreviewDocNow()
                  if (next === 'json') refreshLabJsonPreview()
                  setLabBodyTab(next)
                }}
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-2 pt-1 sm:px-4 sm:pb-3"
              >
                <TabsList className="h-auto w-auto shrink-0 flex-wrap justify-start gap-1 p-1">
                  <TabsTrigger value="edit" className="shrink-0">
                    {t(
                      markupMode === 'asciidoc'
                        ? 'Advanced lab markup label asciidoc'
                        : 'Advanced lab markup label markdown'
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="shrink-0">
                    {t('Advanced lab preview')}
                  </TabsTrigger>
                  <TabsTrigger value="json" className="shrink-0">
                    {t('Advanced lab json preview')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="edit"
                  forceMount
                  className="mt-0 flex min-h-0 flex-1 flex-col gap-2 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  <AdvancedEventLabMarkupToolbar
                    markupMode={markupMode}
                    viewRef={markupView}
                    sliceRef={sliceRef}
                  />
                  <div
                    ref={markupHost}
                    className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border bg-muted/20"
                  />
                </TabsContent>

                <TabsContent
                  value="preview"
                  className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background p-3 text-left">
                    <AdvancedEventLabPreviewPane
                      markupMode={markupMode}
                      source={previewDoc}
                      previewAuthorPubkey={previewAuthorPubkey}
                      previewEmojiTags={mergedLabPreviewEmojiTags}
                    />
                  </div>
                </TabsContent>

                <TabsContent
                  value="json"
                  className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  <p className="shrink-0 text-xs text-muted-foreground mb-2">
                    {t('Advanced lab json preview hint')}
                  </p>
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono select-text text-foreground">
                      {labJsonPreview || '{}'}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="max-h-[min(50dvh,28rem)] shrink-0 overflow-y-auto overscroll-y-contain border-t bg-background px-3 py-3 sm:px-4 md:hidden">
                {labFormSidebar}
              </div>
            </div>
          </div>

          <div
            ref={setLabPickerPortalContainer}
            data-nested-picker-portal
            className="pointer-events-none absolute inset-0 z-[300] overflow-visible"
            aria-hidden={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Full-viewport shell; nested portal host should also be fixed inset-0 (see PostEditor). */
function cnDialogShell(nestedInComposer = false): string {
  return [
    'z-[301] pointer-events-auto !flex max-w-none flex-col gap-0 overflow-hidden p-0 rounded-none',
    '!translate-x-0 !translate-y-0',
    'h-[100dvh] w-[100vw] max-h-[100dvh] max-w-[100vw]',
    'pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]',
    nestedInComposer ? 'absolute inset-0' : '!fixed inset-0 top-0 left-0'
  ].join(' ')
}
