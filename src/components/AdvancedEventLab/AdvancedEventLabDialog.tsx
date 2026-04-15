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
import {
  parseLabSlice,
  serializeLabSlice,
  type AdvancedEventLabSlice
} from '@/lib/advanced-event-lab-slice'
import { isTranslateConfigured, translatePlainText } from '@/lib/translate-client'
import { setReadAloudTranslationForEvent } from '@/lib/read-aloud-translation-override'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { StreamLanguage } from '@codemirror/language'
import { asciidoc } from 'codemirror-asciidoc'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder
} from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export type AdvancedEventLabDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Snapshot when opening; parent should memoize. */
  initial: AdvancedEventLabSlice | null
  /** When false, `kind` in JSON is shown but Apply forces `initial.kind`. */
  kindEditable?: boolean
  markupMode: 'markdown' | 'asciidoc'
  /** `i18n.language` for LanguageTool default ordering. */
  i18nLanguage?: string
  /** When set, user can store translation for read-aloud for this event id. */
  contextEventId?: string | null
  onApply: (payload: AdvancedEventLabSlice) => void
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
  onApply
}: AdvancedEventLabDialogProps) {
  const { t, i18n } = useTranslation()
  const dark = useDarkModeFlag()
  const markupHost = useRef<HTMLDivElement>(null)
  const jsonHost = useRef<HTMLDivElement>(null)
  const markupView = useRef<EditorView | null>(null)
  const jsonView = useRef<EditorView | null>(null)
  const sliceRef = useRef<AdvancedEventLabSlice | null>(null)
  const syncing = useRef(false)

  const ltList = useMemo(
    () => buildLanguageToolPreferenceList(i18nLanguage ?? i18n.language),
    [i18nLanguage, i18n.language]
  )
  const [ltLang, setLtLang] = useState(() => ltList[0] ?? 'en-US')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [translateTarget, setTranslateTarget] = useState('en')

  useEffect(() => {
    if (open) {
      setLtLang(ltList[0] ?? 'en-US')
    }
  }, [open, ltList])

  const destroyEditors = useCallback(() => {
    markupView.current?.destroy()
    jsonView.current?.destroy()
    markupView.current = null
    jsonView.current = null
  }, [])

  useEffect(() => {
    if (!open || !initial) {
      destroyEditors()
      return
    }
    const mkEl = markupHost.current
    const jsEl = jsonHost.current
    if (!mkEl || !jsEl) return

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
      cmPlaceholder(t('Advanced lab markup placeholder')),
      markupLang,
      EditorView.theme({
        '&': { maxHeight: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { minHeight: '220px', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncing.current) return
        const content = update.state.doc.toString()
        const s = sliceRef.current
        if (!s) return
        s.content = content
        const jv = jsonView.current
        if (!jv) return
        const nextJson = serializeLabSlice({
          kind: kindEditable ? s.kind : (initial?.kind ?? s.kind),
          content: s.content,
          tags: s.tags
        })
        if (jv.state.doc.toString() === nextJson) return
        syncing.current = true
        jv.dispatch({
          changes: { from: 0, to: jv.state.doc.length, insert: nextJson },
          selection: { anchor: 0 }
        })
        syncing.current = false
      })
    ]
    if (isLanguageToolConfigured()) {
      mkExtensions.push(languageToolLintExtension(ltLang, 450))
    }
    if (dark) mkExtensions.push(oneDark)

    const jsonExtensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineNumbers(),
      json(),
      cmPlaceholder(t('Advanced lab json placeholder')),
      EditorView.theme({
        '&': { maxHeight: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { minHeight: '220px', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncing.current) return
        const parsed = parseLabSlice(update.state.doc.toString())
        if (!parsed.ok) {
          setJsonError(parsed.error)
          return
        }
        setJsonError(null)
        const fixedKind = kindEditable ? parsed.value.kind : (initial.kind ?? parsed.value.kind)
        const next: AdvancedEventLabSlice = {
          kind: fixedKind,
          content: parsed.value.content,
          tags: parsed.value.tags
        }
        sliceRef.current = next
        const mv = markupView.current
        if (mv && mv.state.doc.toString() !== next.content) {
          syncing.current = true
          mv.dispatch({
            changes: { from: 0, to: mv.state.doc.length, insert: next.content },
            selection: { anchor: Math.min(mv.state.selection.main.anchor, next.content.length) }
          })
          syncing.current = false
        }
      })
    ]
    if (dark) jsonExtensions.push(oneDark)

    const mkState = EditorState.create({
      doc: baseSlice.content,
      extensions: mkExtensions
    })
    const jsState = EditorState.create({
      doc: serializeLabSlice({
        kind: baseSlice.kind,
        content: baseSlice.content,
        tags: baseSlice.tags
      }),
      extensions: jsonExtensions
    })

    markupView.current = new EditorView({ state: mkState, parent: mkEl })
    jsonView.current = new EditorView({ state: jsState, parent: jsEl })

    return destroyEditors
  }, [
    open,
    initial,
    markupMode,
    ltLang,
    kindEditable,
    dark,
    destroyEditors,
    t
  ])

  const handleApply = () => {
    const raw = jsonView.current?.state.doc.toString() ?? ''
    const parsed = parseLabSlice(raw)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    const kind = kindEditable ? parsed.value.kind : (initial?.kind ?? parsed.value.kind)
    const payload: AdvancedEventLabSlice = {
      kind,
      content: parsed.value.content,
      tags: parsed.value.tags
    }
    onApply(payload)
    onOpenChange(false)
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
      syncing.current = true
      markupView.current.dispatch({
        changes: { from: 0, to: markupView.current.state.doc.length, insert: out }
      })
      syncing.current = false
      const s = sliceRef.current
      if (s) {
        s.content = out
        const jv = jsonView.current
        if (jv) {
          const nextJson = serializeLabSlice({
            kind: kindEditable ? s.kind : (initial?.kind ?? s.kind),
            content: out,
            tags: s.tags
          })
          syncing.current = true
          jv.dispatch({ changes: { from: 0, to: jv.state.doc.length, insert: nextJson } })
          syncing.current = false
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[250] max-h-[92vh] w-[min(96vw,72rem)] flex flex-col gap-0 p-0 overflow-hidden">
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
          {jsonError ? (
            <p className="text-sm text-destructive" role="alert">
              {jsonError}
            </p>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-2 px-4 py-2 overflow-hidden">
          <div className="flex flex-col min-h-0 gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('Advanced lab markup')}</span>
            <div
              ref={markupHost}
              className="flex-1 min-h-[200px] border rounded-md overflow-hidden bg-muted/20"
            />
          </div>
          <div className="flex flex-col min-h-0 gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('Advanced lab tags JSON')}</span>
            <div
              ref={jsonHost}
              className="flex-1 min-h-[200px] border rounded-md overflow-hidden bg-muted/20"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 px-4 py-3 border-t gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={handleApply} disabled={Boolean(jsonError)}>
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
