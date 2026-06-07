import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseEditorJsonToText, plainTextToTipTapDoc } from '@/lib/tiptap'
import { cn } from '@/lib/utils'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import postEditorService from '@/services/post-editor.service'
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
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import {
  Dispatch,
  forwardRef,
  SetStateAction,
  useCallback,
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
import type { TContentWarningDraftOptions } from '@/lib/content-warning'

export type TPostTextareaHandle = {
  appendText: (text: string, addNewline?: boolean) => void
  insertText: (text: string) => void
  insertEmoji: (emoji: string | TEmoji) => void
  clear: () => void
  /** Re-read `postEditorCache` / `defaultContent` into TipTap (dialog reopened; initial `content` only runs once). */
  syncFromPostCache: () => void
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
    mediaImetaTags?: string[][]
    mediaUrl?: string
    articleMetadata?: {
      title?: string
      summary?: string
      image?: string
      dTag?: string
      topics?: string[]
      affectedKinds?: number[]
    }
    musicTrackMetadata?: {
      dTag?: string
      title?: string
      audioUrl?: string
      artist?: string
      imageUrl?: string
      album?: string
      durationSec?: number
      format?: string
      language?: string
      genres?: string[]
    }
    extraPreviewTags?: string[][]
    addClientTag?: boolean
    contentWarning?: TContentWarningDraftOptions
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
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      musicTrackMetadata,
      extraPreviewTags,
      addClientTag = true,
      contentWarning
    },
    ref
  ) => {
    const { t } = useTranslation()
    const isSmallScreen = useScreenSizeOptional()?.isSmallScreen ?? false
    const onUploadSuccessRef = useRef(onUploadSuccess)
    onUploadSuccessRef.current = onUploadSuccess
    const onUploadCompressPhaseRef = useRef(onUploadCompressPhase)
    onUploadCompressPhaseRef.current = onUploadCompressPhase
    const onUploadCompressProgressRef = useRef(onUploadCompressProgress)
    onUploadCompressProgressRef.current = onUploadCompressProgress
    const onUploadStartRef = useRef(onUploadStart)
    onUploadStartRef.current = onUploadStart
    const onUploadEndRef = useRef(onUploadEnd)
    onUploadEndRef.current = onUploadEnd
    const onUploadProgressRef = useRef(onUploadProgress)
    onUploadProgressRef.current = onUploadProgress
    const onSubmitRef = useRef(onSubmit)
    onSubmitRef.current = onSubmit
    const [activeTab, setActiveTab] = useState('edit')
    const activeTabRef = useRef(activeTab)
    activeTabRef.current = activeTab
    const [previewContent, setPreviewContent] = useState('')
    const editorRef = useRef<Editor | null>(null)

    const syncPreviewFromEditor = useCallback(() => {
      const ed = editorRef.current
      const live = ed ? parseEditorJsonToText(ed.getJSON()) : text
      setPreviewContent(live)
      if (ed) setText(live)
      return live
    }, [setText, text])

    const previewSurfaceClass = cn(
      isSmallScreen ? 'min-h-[min(36dvh,17rem)]' : 'min-h-52'
    )

    const kindDescription = useMemo(() => getKindDescription(kind), [kind])

    const placeholderText = useMemo(
      () => t('Write something...') + ' (' + t('Paste or drop media files to upload') + ')',
      [t]
    )

    // Extension instances must be stable — recreating them each render makes useEditor destroy/recreate
    // the editor (blank composer in reply dialog).
    const extensions = useMemo(
      () => [
        Document,
        Paragraph,
        Text,
        History,
        HardBreak,
        Placeholder.configure({ placeholder: placeholderText }),
        Emoji.configure({ suggestion: emojiSuggestion }),
        Mention.configure({ suggestion: mentionSuggestion }),
        ClipboardAndDropHandler.configure({
          onUploadStart: (file, cancel) => onUploadStartRef.current?.(file, cancel),
          onUploadEnd: (file) => onUploadEndRef.current?.(file),
          onUploadProgress: (file, p) => onUploadProgressRef.current?.(file, p),
          onUploadSuccess: (result) => onUploadSuccessRef.current?.(result),
          onUploadCompressPhase: (file, phase) =>
            onUploadCompressPhaseRef.current?.(file, phase),
          onUploadCompressProgress: (file, pct) =>
            onUploadCompressProgressRef.current?.(file, pct)
        })
      ],
      [placeholderText]
    )

    const editorSurfaceClass = useMemo(
      () =>
        cn(
          'border rounded-lg p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          isSmallScreen && 'h-full min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
          className
        ),
      [className, isSmallScreen]
    )

    const editor = useEditor({
      // TipTap + Radix Dialog/Tabs: defer init so React 18 does not warn about flushSync in a lifecycle.
      immediatelyRender: false,
      extensions,
      editorProps: {
        attributes: {
          class: editorSurfaceClass
        },
        handleKeyDown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmitRef.current?.()
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
        const live = parseEditorJsonToText(props.editor.getJSON())
        setText(live)
        if (activeTabRef.current === 'preview') {
          setPreviewContent(live)
        }
        postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, props.editor.getJSON())
      },
      onCreate(props) {
        const live = parseEditorJsonToText(props.editor.getJSON())
        setText(live)
        setPreviewContent(live)
      }
    })

    editorRef.current = editor

    useEffect(() => {
      postEditorService.setReplyParentEvent(parentEvent)
      return () => postEditorService.setReplyParentEvent(undefined)
    }, [parentEvent])

    useEffect(() => {
      if (!editor) return
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes: { class: editorSurfaceClass }
        }
      })
    }, [editor, editorSurfaceClass])


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
          setPreviewContent('')
        }
      },
      syncFromPostCache: () => {
        const editor = editorRef.current
        if (!editor) return
        const next = postEditorCache.getPostContentCache({ kind, defaultContent, parentEvent })
        if (next === undefined) return
        editor.chain().setContent(next).run()
        const json = editor.getJSON()
        const live = parseEditorJsonToText(json)
        setText(live)
        setPreviewContent(live)
        postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, json)
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
        const live = parseEditorJsonToText(editor.getJSON())
        setText(live)
        setPreviewContent(live)
      }
    }))

    const editorShellClass = cn(
      'border rounded-lg p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      className
    )

    return (
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (tab === 'preview') {
            syncPreviewFromEditor()
          }
          setActiveTab(tab)
        }}
        className={cn(
          isSmallScreen ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden' : 'space-y-2'
        )}
      >
        <div className="flex min-w-0 shrink-0 flex-col gap-2">
          <TabsList className="w-auto shrink-0 justify-start">
            <TabsTrigger value="edit" title={t('Edit')}>
              {t('Edit')}
            </TabsTrigger>
            <TabsTrigger value="preview" title={t('Preview')}>
              {t('Preview')}
            </TabsTrigger>
          </TabsList>
          {headerActions ? (
            <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1 overflow-x-auto overscroll-x-contain">
              {headerActions}
            </div>
          ) : null}
        </div>
        <TabsContent
          value="edit"
          forceMount
          className={cn(
            'mt-0 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0',
            isSmallScreen && 'flex min-h-0 flex-1 flex-col overflow-hidden'
          )}
        >
          {editor ? (
            <EditorContent
              className={cn(
                'tiptap',
                isSmallScreen && 'flex min-h-0 flex-1 flex-col overflow-hidden'
              )}
              editor={editor}
            />
          ) : (
            <div
              className={cn(editorShellClass, 'text-muted-foreground')}
              aria-hidden
            >
              {placeholderText}
            </div>
          )}
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className={cn(
            'mt-0 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0',
            isSmallScreen && 'flex min-h-0 flex-1 flex-col overflow-hidden'
          )}
        >
          <div className={cn('space-y-2', isSmallScreen && 'flex min-h-0 flex-1 flex-col')}>
            <div className="text-xs text-muted-foreground shrink-0">
              kind {kindDescription.number}: {kindDescription.description}
            </div>
            <Preview
              content={previewContent}
              className={previewSurfaceClass}
              kind={kind}
              highlightData={highlightData}
              pollCreateData={pollCreateData}
              mediaImetaTags={mediaImetaTags}
              mediaUrl={mediaUrl}
              articleMetadata={articleMetadata}
              musicTrackMetadata={musicTrackMetadata}
              extraPreviewTags={extraPreviewTags}
              addClientTag={addClientTag}
              contentWarning={contentWarning}
            />
          </div>
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
