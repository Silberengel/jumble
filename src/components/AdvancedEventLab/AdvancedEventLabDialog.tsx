import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { isLanguageToolConfigured } from '@/lib/languagetool-client'
import { languageToolLintExtension } from '@/lib/languagetool-cm-linter'
import { buildLanguageToolPreferenceList } from '@/lib/languagetool-language-order'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import { isTranslateConfigured, translatePlainText } from '@/lib/translate-client'
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
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdvancedEventLabMarkupToolbar } from './AdvancedEventLabMarkupToolbar'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import type { TEmoji } from '@/types'

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
  formatToolbar?: ReactNode
  /**
   * When set, lab markup/tags are debounced to the post-editor draft store (same persistence as TipTap)
   * so a **reload** can restore in-progress lab work. Closing without Apply (dismiss actions, including the cancel button, Escape, overlay)
   * clears this draft so the next open is seeded from TipTap again.
   */
  draftPersistenceKey?: string | null
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
  formatToolbar,
  draftPersistenceKey = null
}: AdvancedEventLabDialogProps) {
  const { t, i18n } = useTranslation()
  const dark = useDarkModeFlag()
  const markupHost = useRef<HTMLDivElement>(null)
  const markupView = useRef<EditorView | null>(null)
  const sliceRef = useRef<AdvancedEventLabSlice | null>(null)
  const draftPersistenceKeyRef = useRef<string | null>(null)
  const labPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** When true, closing is from Apply (draft already cleared); skip discard cleanup. */
  const skipClearLabDraftOnCloseRef = useRef(false)
  /** Debounce writes to the draft map; pagehide/beforeunload flush immediately to disk. */
  const LAB_DRAFT_DEBOUNCE_MS = 500

  draftPersistenceKeyRef.current = draftPersistenceKey ?? null

  const flushLabDraftNow = useCallback((key: string) => {
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
    postEditorCache.flushPersist()
  }, [])

  useEffect(() => {
    if (!open || !draftPersistenceKey) return
    const key = draftPersistenceKey
    const onPageLeave = () => {
      flushLabDraftNow(key)
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

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        if (!skipClearLabDraftOnCloseRef.current) {
          if (labPersistTimerRef.current) {
            clearTimeout(labPersistTimerRef.current)
            labPersistTimerRef.current = null
          }
          const key = draftPersistenceKeyRef.current
          if (key) {
            postEditorCache.clearAdvancedLabDraft(key)
          }
        }
        skipClearLabDraftOnCloseRef.current = false
      }
      onOpenChange(next)
    },
    [onOpenChange]
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

  const ltList = useMemo(
    () => buildLanguageToolPreferenceList(i18nLanguage ?? i18n.language),
    [i18nLanguage, i18n.language]
  )
  const [ltLang, setLtLang] = useState(() => ltList[0] ?? 'en-US')
  const [translateTarget, setTranslateTarget] = useState('en')

  useEffect(() => {
    if (open) {
      setLtLang(ltList[0] ?? 'en-US')
    }
  }, [open, ltList])

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

      const baseSlice: AdvancedEventLabSlice = {
        kind: initial.kind,
        content: initial.content,
        tags: initial.tags.map((row) => [...row])
      }
      sliceRef.current = baseSlice

      const markupLang: Extension =
        markupMode === 'asciidoc' ? StreamLanguage.define(asciidoc) : markdown()

      const mkExtensions: Extension[] = [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        cmPlaceholder(
          t(
            markupMode === 'asciidoc'
              ? 'Advanced lab markup placeholder asciidoc'
              : 'Advanced lab markup placeholder markdown'
          )
        ),
        markupLang,
        EditorView.theme({
          '&': { maxHeight: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': {
            minHeight: 'min(50dvh, 42rem)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)'
          }
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const content = update.state.doc.toString()
          const s = sliceRef.current
          if (!s) return
          s.content = content
          scheduleLabDraftPersist()
        })
      ]
      if (isLanguageToolConfigured()) {
        mkExtensions.push(languageToolLintExtension(ltLang, 450))
      }
      if (dark) mkExtensions.push(oneDark)

      const mkState = EditorState.create({
        doc: baseSlice.content,
        extensions: mkExtensions
      })

      markupView.current = new EditorView({ state: mkState, parent: mkEl })

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
    initial,
    markupMode,
    ltLang,
    dark,
    destroyEditors,
    t,
    bodyApiRef,
    scheduleLabDraftPersist,
    flushLabDraftNow
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
      tags: s.tags.map((row) => [...row])
    }
    skipClearLabDraftOnCloseRef.current = true
    onApply(payload)
    if (draftPersistenceKeyRef.current) {
      postEditorCache.clearAdvancedLabDraft(draftPersistenceKeyRef.current)
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
    try {
      const out = await translatePlainText(text, translateTarget.trim() || 'en')
      if (!markupView.current) return
      markupView.current.dispatch({
        changes: { from: 0, to: markupView.current.state.doc.length, insert: out }
      })
      const s = sliceRef.current
      if (s) s.content = out
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

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        overlayClassName="z-[205]"
        className={cnDialogShell()}
      >
        <DialogHeader className="shrink-0 px-4 pt-4 pb-2 pr-12 border-b">
          <DialogTitle>{t('Advanced event lab')}</DialogTitle>
          <DialogDescription className="text-left">
            {t('Advanced lab hint')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-4 py-2 border-b shrink-0 flex-wrap">
          <div className="flex flex-wrap items-end gap-3">
            {isLanguageToolConfigured() ? (
              <div className="space-y-1 min-w-[10rem]">
                <Label htmlFor="lt-lang">{t('Advanced lab grammar language')}</Label>
                <Select value={ltLang} onValueChange={setLtLang}>
                  <SelectTrigger id="lt-lang" className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {ltList.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {isTranslateConfigured() ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="tr-tgt">{t('Advanced lab translation target')}</Label>
                  <Input
                    id="tr-tgt"
                    className="w-24 font-mono text-sm"
                    value={translateTarget}
                    onChange={(e) => setTranslateTarget(e.target.value)}
                    placeholder="en"
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleTranslate()}>
                  {t('Advanced lab translate')}
                </Button>
              </div>
            ) : null}
            {contextEventId && isTranslateConfigured() ? (
              <Button type="button" variant="outline" size="sm" onClick={handleReadAloudBuffer}>
                {t('Advanced lab use translation read aloud')}
              </Button>
            ) : null}
          </div>
        </div>

        <AdvancedEventLabMarkupToolbar markupMode={markupMode} viewRef={markupView} sliceRef={sliceRef} />

        <div className="flex-1 min-h-0 flex flex-col gap-1 px-4 py-2 overflow-hidden">
          <span className="text-xs font-medium text-muted-foreground shrink-0">
            {t(
              markupMode === 'asciidoc'
                ? 'Advanced lab markup label asciidoc'
                : 'Advanced lab markup label markdown'
            )}
          </span>
          <div
            ref={markupHost}
            className="flex-1 min-h-[min(50dvh,36rem)] border rounded-md overflow-hidden bg-muted/20"
          />
        </div>

        {formatToolbar ? (
          <div className="shrink-0 border-t bg-muted/20 px-2 py-2">{formatToolbar}</div>
        ) : null}

        <DialogFooter className="shrink-0 px-4 py-3 border-t gap-2">
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
            {t('Advanced lab cancel undo')}
          </Button>
          <Button type="button" onClick={handleApply}>
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Responsive shell: ~5× prior max width cap and ~3× vertical use of viewport (still clamped). */
function cnDialogShell(): string {
  return [
    'z-[250] max-w-none flex flex-col gap-0 p-0 overflow-hidden',
    'w-[min(98vw,calc(72rem*5))]',
    'h-[min(94vh,calc(28rem*3))]',
    'max-h-[min(96vh,90dvh)]'
  ].join(' ')
}
