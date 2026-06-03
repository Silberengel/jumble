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
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
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
      addClientTag = true
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
    const [activeTab, setActiveTab] = useState('edit')
    const editorRef = useRef<Editor | null>(null)

    const kindDescription = useMemo(() => getKindDescription(kind), [kind])

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

    useEffect(() => {
      if (!editor || !isSmallScreen) return
      const scrollEditorIntoView = () => {
        requestAnimationFrame(() => {
          editor.view.dom.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        })
      }
      editor.on('focus', scrollEditorIntoView)
      return () => {
        editor.off('focus', scrollEditorIntoView)
      }
    }, [editor, isSmallScreen])

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
      syncFromPostCache: () => {
        const editor = editorRef.current
        if (!editor) return
        const next = postEditorCache.getPostContentCache({ kind, defaultContent, parentEvent })
        if (next === undefined) return
        editor.chain().setContent(next).run()
        const json = editor.getJSON()
        setText(parseEditorJsonToText(json))
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
        setText(parseEditorJsonToText(editor.getJSON()))
      }
    }))

    if (!editor) {
      return null
    }

    return (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-2">
        <div className="flex min-w-0 flex-col gap-2">
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
          className="mt-0 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <EditorContent className="tiptap" editor={editor} />
        </TabsContent>
        <TabsContent
          value="preview"
          className="mt-0 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0"
        >
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
              musicTrackMetadata={musicTrackMetadata}
              extraPreviewTags={extraPreviewTags}
              addClientTag={addClientTag}
            />
          </div>
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
