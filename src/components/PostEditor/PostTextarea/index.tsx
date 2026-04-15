import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseEditorJsonToText, plainTextToTipTapDoc } from '@/lib/tiptap'
import { cn } from '@/lib/utils'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { TEmoji } from '@/types'
import Document from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import { Event } from 'nostr-tools'
import {
  Dispatch,
  forwardRef,
  SetStateAction,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardAndDropHandler } from './ClipboardAndDropHandler'
import Emoji from './Emoji'
import emojiSuggestion from './Emoji/suggestion'
import Mention from './Mention'
import mentionSuggestion from './Mention/suggestion'
import Preview from './Preview'
import { HighlightData } from '../HighlightEditor'
import { getKindDescription } from '@/lib/kind-description'
import { parseLabSlice } from '@/lib/advanced-event-lab-slice'

/** Draft JSON uses relay fetches (e.g. thread root); cap wait so the Json tab cannot spin forever. */
const DRAFT_JSON_PREVIEW_TIMEOUT_MS = 25_000

export type TPostTextareaHandle = {
  appendText: (text: string, addNewline?: boolean) => void
  insertText: (text: string) => void
  insertEmoji: (emoji: string | TEmoji) => void
  clear: () => void
  getText: () => string
  /** Replace editor from plain `content` (e.g. advanced lab). Syncs TipTap JSON cache and parent `text`. */
  setDocumentFromPlainText: (plain: string) => void
}

const PostTextarea = forwardRef<
  TPostTextareaHandle,
  {
    text: string
    setText: Dispatch<SetStateAction<string>>
    defaultContent?: string
    parentEvent?: Event
    onSubmit?: () => void
    className?: string
    onUploadStart?: (file: File, cancel: () => void) => void
    onUploadProgress?: (file: File, progress: number) => void
    onUploadEnd?: (file: File) => void
    onUploadSuccess?: (result: {
      url: string
      tags: string[][]
      file: File
      urlAlreadyInEditor?: boolean
    }) => void
    onUploadCompressPhase?: (file: File, phase: 'compressing' | 'uploading') => void
    onUploadCompressProgress?: (file: File, percent: number) => void
    kind?: number
    highlightData?: HighlightData
    pollCreateData?: import('@/types').TPollCreateData
    headerActions?: React.ReactNode
    getDraftEventJson?: () => Promise<string>
    /** When set with `onApplyComposerDraftJson`, the Json tab becomes editable with Apply. */
    expectedDraftKind?: number
    onApplyComposerDraftJson?: (rawJson: string) => boolean
    mediaImetaTags?: string[][]
    mediaUrl?: string
    articleMetadata?: {
      title?: string
      summary?: string
      image?: string
      dTag?: string
      topics?: string[]
    }
    extraPreviewTags?: string[][]
    addClientTag?: boolean
  }
>(
  (
    {
      text = '',
      setText,
      defaultContent,
      parentEvent,
      onSubmit,
      className,
      onUploadStart,
      onUploadProgress,
      onUploadEnd,
      onUploadSuccess,
      onUploadCompressPhase,
      onUploadCompressProgress,
      kind = 1,
      highlightData,
      pollCreateData,
      headerActions,
      getDraftEventJson,
      expectedDraftKind,
      onApplyComposerDraftJson,
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      extraPreviewTags,
      addClientTag = true
    },
    ref
  ) => {
    const { t } = useTranslation()
    const onUploadSuccessRef = useRef(onUploadSuccess)
    onUploadSuccessRef.current = onUploadSuccess
    const onUploadCompressPhaseRef = useRef(onUploadCompressPhase)
    onUploadCompressPhaseRef.current = onUploadCompressPhase
    const onUploadCompressProgressRef = useRef(onUploadCompressProgress)
    onUploadCompressProgressRef.current = onUploadCompressProgress
    const [activeTab, setActiveTab] = useState('preview')
    const [draftEventJson, setDraftEventJson] = useState<string>('')
    const [isLoadingJson, setIsLoadingJson] = useState(false)
    const [jsonFieldValue, setJsonFieldValue] = useState('')
    const [jsonReloadToken, setJsonReloadToken] = useState(0)
    /** Bumps when preview tab is shown or a new JSON fetch starts; completions only apply if seq still matches. */
    const jsonPanelFetchSeq = useRef(0)
    const editorRef = useRef<Editor | null>(null)

    const kindDescription = useMemo(() => getKindDescription(kind), [kind])

    useEffect(() => {
      if (activeTab === 'preview') {
        jsonPanelFetchSeq.current += 1
        setDraftEventJson('')
        setIsLoadingJson(false)
        return
      }

      if (activeTab !== 'json' || !getDraftEventJson) {
        return
      }

      const seq = ++jsonPanelFetchSeq.current
      setIsLoadingJson(true)

      let timeoutId: number | undefined = window.setTimeout(() => {
        timeoutId = undefined
        if (seq !== jsonPanelFetchSeq.current) return
        setDraftEventJson(
          `Error generating JSON: Timed out after ${Math.round(DRAFT_JSON_PREVIEW_TIMEOUT_MS / 1000)}s (relays or network slow)`
        )
        setIsLoadingJson(false)
      }, DRAFT_JSON_PREVIEW_TIMEOUT_MS)

      const clearJsonTimeout = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
      }

      void Promise.resolve(getDraftEventJson())
        .then((json) => {
          clearJsonTimeout()
          if (seq !== jsonPanelFetchSeq.current) return
          setDraftEventJson(json)
          setIsLoadingJson(false)
        })
        .catch((error: unknown) => {
          clearJsonTimeout()
          if (seq !== jsonPanelFetchSeq.current) return
          const msg = error instanceof Error ? error.message : String(error)
          setDraftEventJson(`Error generating JSON: ${msg}`)
          setIsLoadingJson(false)
        })

      // `text` is included so JSON refreshes when the parent memoizes `getDraftEventJson` too narrowly;
      // `kind` catches compose-mode switches even if callback identity were ever stable across them.
      // Use `jsonPanelFetchSeq` instead of an effect cleanup `cancelled` flag so a superseded fetch
      // does not skip `setIsLoadingJson(false)` and leave the Json tab stuck on "Loading...".
    }, [activeTab, getDraftEventJson, kind, text, jsonReloadToken])

    useEffect(() => {
      if (activeTab !== 'json' || isLoadingJson) return
      setJsonFieldValue(draftEventJson)
    }, [activeTab, isLoadingJson, draftEventJson])
    const editor = useEditor({
      // TipTap + Radix Dialog/Tabs: defer init so React 18 does not warn about flushSync in a lifecycle.
      immediatelyRender: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        History,
        HardBreak,
        Placeholder.configure({
          placeholder:
            t('Write something...') + ' (' + t('Paste or drop media files to upload') + ')'
        }),
        Emoji.configure({
          suggestion: emojiSuggestion
        }),
        Mention.configure({
          suggestion: mentionSuggestion
        }),
        ClipboardAndDropHandler.configure({
          onUploadStart: (file, cancel) => {
            onUploadStart?.(file, cancel)
          },
          onUploadEnd: (file) => onUploadEnd?.(file),
          onUploadProgress: (file, p) => onUploadProgress?.(file, p),
          onUploadSuccess: (result) => onUploadSuccessRef.current?.(result),
          onUploadCompressPhase: (file, phase) =>
            onUploadCompressPhaseRef.current?.(file, phase),
          onUploadCompressProgress: (file, pct) =>
            onUploadCompressProgressRef.current?.(file, pct)
        })
      ],
      editorProps: {
        attributes: {
          class: cn(
            'border rounded-lg p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )
        },
        handleKeyDown: (_view, event) => {
          // Handle Ctrl+Enter or Cmd+Enter for submit
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmit?.()
            return true
          }
          return false
        },
        clipboardTextSerializer(content) {
          return parseEditorJsonToText(content.toJSON())
        }
      },
      content: postEditorCache.getPostContentCache({ kind, defaultContent, parentEvent }),
      onUpdate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
        postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, props.editor.getJSON())
      },
      onCreate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
      }
    })

    editorRef.current = editor

    useImperativeHandle(ref, () => ({
      appendText: (text: string, addNewline = false) => {
        const ed = editorRef.current
        if (ed) {
          let chain = ed
            .chain()
            .focus()
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                const endPos = tr.doc.content.size
                const selection = TextSelection.create(tr.doc, endPos)
                tr.setSelection(selection)
                dispatch(tr)
              }
              return true
            })
            .insertContent(text)
          if (addNewline) {
            chain = chain.setHardBreak()
          }
          chain.run()
        }
      },
      insertText: (text: string) => {
        const editor = editorRef.current
        if (editor) {
          editor.chain().focus().insertContent(text).run()
        }
      },
      insertEmoji: (emoji: string | TEmoji) => {
        const editor = editorRef.current
        if (editor) {
          if (typeof emoji === 'string') {
            editor.chain().insertContent(emoji).run()
          } else {
            const emojiNode = editor.schema.nodes.emoji.create({
              name: customEmojiService.getEmojiId(emoji)
            })
            editor.chain().insertContent(emojiNode).insertContent(' ').run()
          }
        }
      },
      clear: () => {
        const editor = editorRef.current
        if (editor) {
          // Clear the editor content and reset to empty document
          editor.chain().clearContent().run()
          // Also clear the cache
          postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, editor.getJSON())
          setText('')
        }
      },
      getText: () => {
        const editor = editorRef.current
        if (editor) {
          // Must match `onUpdate` / `clipboardTextSerializer` / `setDocumentFromPlainText` follow-up.
          // TipTap's `editor.getText()` uses a multi-line block separator (e.g. `\n\n`), which does not
          // round-trip with `plainTextToTipTapDoc` (one paragraph per `\n`) and inflates blank lines.
          return parseEditorJsonToText(editor.getJSON())
        }
        return ''
      },
      setDocumentFromPlainText: (plain: string) => {
        const editor = editorRef.current
        if (!editor) return
        const json = plainTextToTipTapDoc(plain)
        editor.chain().setContent(json).run()
        postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, editor.getJSON())
        setText(parseEditorJsonToText(editor.getJSON()))
      }
    }))

    if (!editor) {
      return null
    }

    return (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <TabsList className="w-auto justify-start">
            <TabsTrigger value="preview" title={t('Preview')}>
              {t('Preview')}
            </TabsTrigger>
            <TabsTrigger value="json" title={t('Json')}>
              {t('Json')}
            </TabsTrigger>
          </TabsList>
          {headerActions && (
            <div className="flex gap-1 items-center flex-wrap">
              {headerActions}
            </div>
          )}
        </div>
        {/* Editor always visible (no Edit tab). Keep mounted; only Preview/Json swap panels below. */}
        <EditorContent className="tiptap" editor={editor} />
        <TabsContent value="preview">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              kind {kindDescription.number}: {kindDescription.description}
            </div>
            <Preview
              content={text}
              className={className}
              kind={kind}
              highlightData={highlightData}
              pollCreateData={pollCreateData}
              mediaImetaTags={mediaImetaTags}
              mediaUrl={mediaUrl}
              articleMetadata={articleMetadata}
              extraPreviewTags={extraPreviewTags}
              addClientTag={addClientTag}
            />
          </div>
        </TabsContent>
        <TabsContent value="json" className="mt-2 flex flex-col gap-2 min-h-0">
          {isLoadingJson ? (
            <div className="text-muted-foreground text-sm">{t('Loading...')}</div>
          ) : expectedDraftKind !== undefined && onApplyComposerDraftJson ? (
            <>
              <p className="text-xs text-muted-foreground">{t('Composer JSON tab hint')}</p>
              <textarea
                className="w-full min-h-[min(55dvh,32rem)] max-h-[min(70vh,40rem)] resize-y rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                spellCheck={false}
                value={jsonFieldValue}
                onChange={(e) => setJsonFieldValue(e.target.value)}
                aria-label={t('Json')}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const parsed = parseLabSlice(jsonFieldValue.trim())
                    if (!parsed.ok) {
                      return
                    }
                    if (parsed.value.kind !== expectedDraftKind) {
                      return
                    }
                    const ok = onApplyComposerDraftJson(jsonFieldValue)
                    if (ok) setJsonReloadToken((n) => n + 1)
                  }}
                  disabled={
                    !jsonFieldValue.trim() ||
                    (() => {
                      const p = parseLabSlice(jsonFieldValue.trim())
                      if (!p.ok) return true
                      if (p.value.kind !== expectedDraftKind) return true
                      return false
                    })()
                  }
                >
                  {t('Composer JSON apply')}
                </Button>
                {(() => {
                  const p = parseLabSlice(jsonFieldValue.trim())
                  if (!jsonFieldValue.trim()) return null
                  if (!p.ok) {
                    return (
                      <span className="text-xs text-destructive" role="alert">
                        {p.error}
                      </span>
                    )
                  }
                  if (p.value.kind !== expectedDraftKind) {
                    return (
                      <span className="text-xs text-destructive" role="alert">
                        {t('composerJsonKindMismatch', {
                          expected: String(expectedDraftKind),
                          got: String(p.value.kind)
                        })}
                      </span>
                    )
                  }
                  return null
                })()}
              </div>
            </>
          ) : (
            <div className="border rounded-lg p-3 bg-muted/40 max-h-[min(70vh,40rem)] overflow-auto select-text">
              <pre className="text-xs whitespace-pre-wrap break-words font-mono select-text">
                {draftEventJson || t('No JSON available')}
              </pre>
            </div>
          )}
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
