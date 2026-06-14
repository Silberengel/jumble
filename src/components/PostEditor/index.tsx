import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { pubkeyToNpub } from '@/lib/pubkey'
import { preloadEmojiPicker } from '@/lib/emoji-picker-preload'
import postEditor from '@/services/post-editor.service'
import { Event } from 'nostr-tools'
import postEditorService from '@/services/post-editor.service'
import { Dispatch, useEffect, useMemo, useRef, useState } from 'react'
import { useNostr } from '@/providers/NostrProvider'
import type { TDiscussionDynamicTopics } from '@/lib/discussion-thread-composer'
import PostContent from './PostContent'

export default function PostEditor({
  defaultContent = '',
  parentEvent,
  open,
  setOpen,
  openFrom,
  initialHighlightData,
  initialPublicMessageTo,
  onPublishSuccess,
  discussionDynamicTopics
}: {
  defaultContent?: string
  parentEvent?: Event
  open: boolean
  setOpen: Dispatch<boolean>
  openFrom?: string[]
  initialHighlightData?: import('./HighlightEditor').HighlightData
  /** When set, opens in public message mode with this pubkey in the mention list. */
  initialPublicMessageTo?: string
  /** Called after a reply/post is successfully published, before closing. */
  onPublishSuccess?: () => void
  /** Hot topics for the discussion (kind 11) composer when integrated in this editor. */
  discussionDynamicTopics?: TDiscussionDynamicTopics | null
}) {
  const { isSmallScreen } = useScreenSize()
  const { isAccountSessionHydrating, isNip07LoginInFlight } = useNostr()
  /** Lock sheet height at open so the mobile keyboard does not resize/jank the composer. */
  const [mobileSheetHeightPx, setMobileSheetHeightPx] = useState<number | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && isSmallScreen && !wasOpenRef.current) {
      const vh = window.visualViewport?.height ?? window.innerHeight
      setMobileSheetHeightPx(Math.round(vh))
    }
    if (!open) {
      setMobileSheetHeightPx(null)
    }
    wasOpenRef.current = open
  }, [open, isSmallScreen])

  useEffect(() => {
    if (!open) return
    postEditorService.setComposerShellOpen(true)
    void preloadEmojiPicker()
    return () => postEditorService.setComposerShellOpen(false)
  }, [open])

  const blockDismissForAccountSwitch =
    isAccountSessionHydrating || isNip07LoginInFlight

  const effectiveDefaultContent = useMemo(() => {
    if (initialPublicMessageTo) {
      const npub = pubkeyToNpub(initialPublicMessageTo)
      const suffix = defaultContent ? ` ${defaultContent}` : ' '
      return npub ? `nostr:${npub}${suffix}`.trimEnd() : defaultContent
    }
    return defaultContent
  }, [initialPublicMessageTo, defaultContent])

  const content = useMemo(() => {
    return (
      <PostContent
        open={open}
        defaultContent={effectiveDefaultContent}
        parentEvent={parentEvent}
        close={() => setOpen(false)}
        openFrom={openFrom}
        initialHighlightData={initialHighlightData}
        initialPublicMessageTo={initialPublicMessageTo}
        onPublishSuccess={onPublishSuccess}
        discussionDynamicTopics={discussionDynamicTopics}
      />
    )
  }, [
    open,
    effectiveDefaultContent,
    parentEvent,
    openFrom,
    setOpen,
    initialHighlightData,
    initialPublicMessageTo,
    onPublishSuccess,
    discussionDynamicTopics
  ])

  if (isSmallScreen) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="flex w-full max-w-full flex-col p-0 border-none overflow-hidden data-[state=open]:duration-200 data-[state=closed]:duration-200"
          style={
            mobileSheetHeightPx != null
              ? { height: mobileSheetHeightPx, maxHeight: mobileSheetHeightPx }
              : { height: 'var(--vh, 100dvh)', maxHeight: 'var(--vh, 100dvh)' }
          }
          side="bottom"
          hideClose
          onInteractOutside={(e) => {
            if (blockDismissForAccountSwitch) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (blockDismissForAccountSwitch) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (postEditor.isSuggestionPopupOpen) {
              e.preventDefault()
              postEditor.closeSuggestionPopup()
            }
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-2 min-w-0 overflow-hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Post Editor</SheetTitle>
              <SheetDescription>Create a new post or reply</SheetDescription>
            </SheetHeader>
            {content}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex max-h-[min(90dvh,900px)] flex-col overflow-hidden p-0 max-w-2xl w-[calc(100vw-2rem)] sm:w-full"
        withoutClose
        onInteractOutside={(e) => {
          if (blockDismissForAccountSwitch) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (blockDismissForAccountSwitch) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (postEditor.isSuggestionPopupOpen) {
            e.preventDefault()
            postEditor.closeSuggestionPopup()
          }
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-6 pb-4 min-w-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Post Editor</DialogTitle>
            <DialogDescription>Create a new post or reply</DialogDescription>
          </DialogHeader>
          {content}
        </div>
      </DialogContent>
    </Dialog>
  )
}
