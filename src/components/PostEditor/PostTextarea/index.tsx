import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseEditorJsonToText, plainTextToTipTapDoc } from '@/lib/tiptap'
import { cn } from '@/lib/utils'
import activityTrace from '@/lib/activity-trace'
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
import ComposerJsonPreview from './ComposerJsonPreview'
import { HighlightData } from '../HighlightEditor'
import type { WebBookmarkDraftData } from '../WebBookmarkEditor'
import { getKindDescription } from '@/lib/kind-description'
import type { TContentWarningDraftOptions } from '@/lib/content-warning'

/** Debounce lifting plain text + draft cache to PostContent (avoids re-rendering the full composer each keystroke). */
const EDITOR_PARENT_SYNC_DEBOUNCE_MS = 250

export type ComposerEditorTab = 'edit' | 'preview' | 'json'

export type TPostTextareaHandle = {
  appendText: (text: string, addNewline?: boolean) => void
  insertText: (text: string) => void
  insertEmoji: (emoji: string | TEmoji) => void
  clear: (options?: { skipCache?: boolean }) => void
  /** Re-read `postEditorCache` / `defaultContent` into TipTap (dialog reopened; initial `content` only runs once). */
  syncFromPostCache: () => void
  /** Drop a pending debounced parent/cache sync (e.g. before clearing draft after publish). */
  cancelPendingEditorSync: () => void
  getText: () => string
  /** Replace editor from plain `content` (e.g. advanced lab). Syncs TipTap JSON cache and parent `text`. */
  setDocumentFromPlainText: (plain: string) => void
}

const PostTextarea = forwardRef<
  TPostTextareaHandle,
  {
    text: string
    setText: Dispatch<SetStateAction<string>>
    /** Fires only when editor empty/non-empty changes (cheap parent state for publish gating). */
    onEditorNonemptyChange?: (nonempty: boolean) => void
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
    /** External media URL pasted into the editor (no upload). */
    onMediaUrlPasted?: (url: string) => void
    kind?: number
    highlightData?: HighlightData
    webBookmarkData?: WebBookmarkDraftData
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
    /** When set, Write tab preview shows this kind (e.g. 1010 edit) while `kind` drives the editor. */
    previewKind?: number
    /** When false (mobile page composer), editor uses a fixed height instead of flex-grow. */
    fillAvailableHeight?: boolean
    /** Notifies parent when Edit / Preview / JSON tab changes (to hide kind-specific inputs). */
    onActiveTabChange?: (tab: ComposerEditorTab) => void
  }
>(
  (
    {
      text = '',
      setText,
      onEditorNonemptyChange,
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
      onMediaUrlPasted,
      kind = 1,
      highlightData,
      webBookmarkData,
      pollCreateData,
      headerActions,
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      musicTrackMetadata,
      extraPreviewTags,
      addClientTag = true,
      contentWarning,
      previewKind,
      fillAvailableHeight = true,
      onActiveTabChange
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
    const onUploadStartRef = useRef(onUploadStart)
    onUploadStartRef.current = onUploadStart
    const onUploadEndRef = useRef(onUploadEnd)
    onUploadEndRef.current = onUploadEnd
    const onUploadProgressRef = useRef(onUploadProgress)
    onUploadProgressRef.current = onUploadProgress
    const onSubmitRef = useRef(onSubmit)
    onSubmitRef.current = onSubmit
    const [activeTab, setActiveTab] = useState<ComposerEditorTab>('edit')
    const activeTabRef = useRef(activeTab)
    activeTabRef.current = activeTab
    const onMediaUrlPastedRef = useRef(onMediaUrlPasted)
    onMediaUrlPastedRef.current = onMediaUrlPasted
    const onActiveTabChangeRef = useRef(onActiveTabChange)
    onActiveTabChangeRef.current = onActiveTabChange

    useEffect(() => {
      onActiveTabChangeRef.current?.(activeTab)
    }, [activeTab])
    const [previewContent, setPreviewContent] = useState('')
    const editorRef = useRef<Editor | null>(null)
    const editorNonemptyRef = useRef(false)
    const parentSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onEditorNonemptyChangeRef = useRef(onEditorNonemptyChange)
    onEditorNonemptyChangeRef.current = onEditorNonemptyChange

    const notifyEditorNonempty = useCallback((editor: Editor) => {
      const nonempty = !editor.isEmpty
      if (nonempty === editorNonemptyRef.current) return
      editorNonemptyRef.current = nonempty
      onEditorNonemptyChangeRef.current?.(nonempty)
    }, [])

    const flushEditorSyncToParent = useCallback(() => {
      if (parentSyncTimeoutRef.current) {
        clearTimeout(parentSyncTimeoutRef.current)
        parentSyncTimeoutRef.current = null
      }
      const ed = editorRef.current
      if (!ed) return
      const json = ed.getJSON()
      const live = parseEditorJsonToText(json)
      setText(live)
      activityTrace.trace('editor', 'PostTextarea.syncToParent', { chars: live.length })
      postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, json)
      notifyEditorNonempty(ed)
    }, [defaultContent, kind, notifyEditorNonempty, parentEvent, setText])

    const scheduleEditorSyncToParent = useCallback(() => {
      if (parentSyncTimeoutRef.current) {
        clearTimeout(parentSyncTimeoutRef.current)
      }
      parentSyncTimeoutRef.current = setTimeout(() => {
        parentSyncTimeoutRef.current = null
        flushEditorSyncToParent()
      }, EDITOR_PARENT_SYNC_DEBOUNCE_MS)
    }, [flushEditorSyncToParent])

    useEffect(() => () => flushEditorSyncToParent(), [flushEditorSyncToParent])

    const syncPreviewFromEditor = useCallback(() => {
      const ed = editorRef.current
      if (!ed) {
        setPreviewContent(text)
        return text
      }
      flushEditorSyncToParent()
      const live = parseEditorJsonToText(ed.getJSON())
      setPreviewContent(live)
      return live
    }, [flushEditorSyncToParent, text])

    const flushEditorSyncToParentRef = useRef(flushEditorSyncToParent)
    flushEditorSyncToParentRef.current = flushEditorSyncToParent
    const scheduleEditorSyncToParentRef = useRef(scheduleEditorSyncToParent)
    scheduleEditorSyncToParentRef.current = scheduleEditorSyncToParent
    const notifyEditorNonemptyRef = useRef(notifyEditorNonempty)
    notifyEditorNonemptyRef.current = notifyEditorNonempty

    const pageEditorShellClass = 'h-[min(42dvh,24rem)] min-h-[12rem] shrink-0'

    const composerPaneHeightClass = useMemo(
      () => {
        if (!fillAvailableHeight) {
          return 'flex-1 min-h-0'
        }
        return 'flex-1 min-h-[14rem]'
      },
      [fillAvailableHeight]
    )

    const composerFillsShell = fillAvailableHeight

    const composerUsesPageShell = !fillAvailableHeight

    const composerBodyScrollClass = cn(
      composerPaneHeightClass,
      'flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain popover-scroll-y',
      'border rounded-lg focus-within:ring-1 focus-within:ring-ring',
      className
    )

    const previewBodyScrollClass = cn(
      composerPaneHeightClass,
      'flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain popover-scroll-y'
    )

    const previewSurfaceClass = 'min-h-0'

    const effectivePreviewKind = previewKind ?? kind
    const previewKindDescription = useMemo(
      () => getKindDescription(effectivePreviewKind),
      [effectivePreviewKind]
    )

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
          onMediaUrlPasted: (url) => onMediaUrlPastedRef.current?.(url),
          onUploadCompressPhase: (file, phase) =>
            onUploadCompressPhaseRef.current?.(file, phase),
          onUploadCompressProgress: (file, pct) =>
            onUploadCompressProgressRef.current?.(file, pct)
        })
      ],
      [placeholderText]
    )

    const editorSurfaceClass = useMemo(
      () => cn('min-h-full p-3 focus-visible:outline-none'),
      []
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
        editorRef.current = props.editor
        notifyEditorNonemptyRef.current(props.editor)
        if (activeTabRef.current === 'preview' || activeTabRef.current === 'json') {
          const live = parseEditorJsonToText(props.editor.getJSON())
          setPreviewContent(live)
          flushEditorSyncToParentRef.current()
          return
        }
        scheduleEditorSyncToParentRef.current()
      },
      onCreate(props) {
        editorRef.current = props.editor
        notifyEditorNonemptyRef.current(props.editor)
        flushEditorSyncToParentRef.current()
        setPreviewContent(parseEditorJsonToText(props.editor.getJSON()))
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
      clear: (options?: { skipCache?: boolean }) => {
        const editor = editorRef.current
        if (parentSyncTimeoutRef.current) {
          clearTimeout(parentSyncTimeoutRef.current)
          parentSyncTimeoutRef.current = null
        }
        if (editor) {
          editor.chain().clearContent().run()
          if (!options?.skipCache) {
            postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, editor.getJSON())
          }
        }
        editorNonemptyRef.current = false
        onEditorNonemptyChangeRef.current?.(false)
        setText('')
        setPreviewContent('')
      },
      cancelPendingEditorSync: () => {
        if (parentSyncTimeoutRef.current) {
          clearTimeout(parentSyncTimeoutRef.current)
          parentSyncTimeoutRef.current = null
        }
      },
      syncFromPostCache: () => {
        const editor = editorRef.current
        if (!editor) return
        const next = postEditorCache.getPostContentCache({ kind, defaultContent, parentEvent })
        if (next === undefined) return
        editor.chain().setContent(next).run()
        flushEditorSyncToParent()
        setPreviewContent(parseEditorJsonToText(editor.getJSON()))
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
        flushEditorSyncToParent()
        setPreviewContent(parseEditorJsonToText(editor.getJSON()))
      }
    }), [flushEditorSyncToParent, kind, defaultContent, parentEvent, setText])

    const editorShellClass = 'min-h-full p-3 text-muted-foreground'

    return (
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          const next = tab as ComposerEditorTab
          if (next === 'preview' || next === 'json') {
            syncPreviewFromEditor()
          }
          setActiveTab(next)
        }}
        className={cn(
          'flex flex-col gap-2 overflow-hidden',
          composerFillsShell && 'min-h-0 min-h-[14rem] flex-1',
          composerUsesPageShell && pageEditorShellClass
        )}
      >
        <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <TabsList className="h-8 w-full shrink-0 justify-start sm:w-auto">
            <TabsTrigger value="edit" className="h-7 px-2.5 text-xs sm:text-sm" title={t('Edit')}>
              {t('Edit')}
            </TabsTrigger>
            <TabsTrigger value="preview" className="h-7 px-2.5 text-xs sm:text-sm" title={t('Preview')}>
              {t('Preview')}
            </TabsTrigger>
            <TabsTrigger
              value="json"
              className="h-7 px-2.5 text-xs sm:text-sm"
              title={t('Advanced lab json preview')}
            >
              {t('Advanced lab json preview')}
            </TabsTrigger>
          </TabsList>
          {headerActions && activeTab === 'edit' ? (
            <div className="flex min-w-0 w-full flex-wrap items-center gap-1 sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end sm:overflow-x-auto sm:overscroll-x-contain">
              {headerActions}
            </div>
          ) : null}
        </div>
        <TabsContent
          value="edit"
          forceMount
          className={cn(
            'mt-0 flex flex-1 flex-col min-h-0 overflow-hidden data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          )}
        >
          <div className={composerBodyScrollClass}>
            {editor ? (
              <EditorContent className="tiptap flex min-h-0 flex-1 flex-col [&_.ProseMirror]:min-h-full" editor={editor} />
            ) : (
              <div className={editorShellClass} aria-hidden>
                {placeholderText}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className={cn(
            'mt-0 flex flex-1 flex-col min-h-0 overflow-hidden data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          )}
        >
          <div className={cn('flex min-h-0 flex-1 flex-col gap-2')}>
            <div className="shrink-0 text-xs text-muted-foreground">
              kind {previewKindDescription.number}: {previewKindDescription.description}
            </div>
            <div className={previewBodyScrollClass}>
              <Preview
                content={previewContent}
                className={previewSurfaceClass}
                kind={effectivePreviewKind}
                highlightData={highlightData}
                webBookmarkData={webBookmarkData}
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
          </div>
        </TabsContent>
        <TabsContent
          value="json"
          forceMount
          className={cn(
            'mt-0 flex flex-1 flex-col min-h-0 overflow-hidden data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          )}
        >
          <ComposerJsonPreview
            content={previewContent}
            kind={effectivePreviewKind}
            highlightData={highlightData}
            webBookmarkData={webBookmarkData}
            pollCreateData={pollCreateData}
            mediaImetaTags={mediaImetaTags}
            mediaUrl={mediaUrl}
            articleMetadata={articleMetadata}
            musicTrackMetadata={musicTrackMetadata}
            extraPreviewTags={extraPreviewTags}
            addClientTag={addClientTag}
            contentWarning={contentWarning}
          />
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
