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
import { Dispatch, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNostr } from '@/providers/NostrProvider'
import { cn } from '@/lib/utils'
import type { TDiscussionDynamicTopics } from '@/lib/discussion-thread-composer'
import PostContent from './PostContent'

function isNestedPickerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        '[data-advanced-lab-shell], [data-suggestion-popup], [data-nested-picker-portal], [data-gif-picker-shell], [data-gif-picker-root], [data-meme-picker-root], [data-emoji-picker-root], [data-emoji-picker-shell], emoji-picker'
      )
    )
  )
}

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
  const [pickerPortalContainer, setPickerPortalContainer] = useState<HTMLElement | null>(null)
  const [advancedLabPortalContainer, setAdvancedLabPortalContainer] = useState<HTMLElement | null>(null)
  const [advancedLabOpen, setAdvancedLabOpen] = useState(false)
  const advancedLabOpenRef = useRef(false)
  const [bodyPortalReady, setBodyPortalReady] = useState(false)
  const blockDismissForAccountSwitch =
    isAccountSessionHydrating || isNip07LoginInFlight

  useEffect(() => {
    advancedLabOpenRef.current = advancedLabOpen
  }, [advancedLabOpen])

  const handleAdvancedLabOpenChange = useCallback((next: boolean) => {
    advancedLabOpenRef.current = next
    setAdvancedLabOpen(next)
  }, [])

  const setPickerPortal = useCallback((el: HTMLElement | null) => {
    setPickerPortalContainer(el)
    postEditorService.setSuggestionPopupPortal(el)
  }, [])

  const setAdvancedLabPortal = useCallback((el: HTMLElement | null) => {
    setAdvancedLabPortalContainer(el)
  }, [])

  useEffect(() => {
    setBodyPortalReady(true)
  }, [])

  useEffect(() => {
    if (!open) handleAdvancedLabOpenChange(false)
  }, [open, handleAdvancedLabOpenChange])

  useEffect(() => {
    return () => postEditorService.setSuggestionPopupPortal(null)
  }, [])

  const handleComposerOpenChange = useCallback(
    (next: boolean) => {
      if (!next && advancedLabOpenRef.current) return
      setOpen(next)
    },
    [setOpen]
  )

  const shouldBlockComposerOutsideDismiss = useCallback(
    (target: EventTarget | null) =>
      advancedLabOpenRef.current ||
      blockDismissForAccountSwitch ||
      isNestedPickerTarget(target),
    [blockDismissForAccountSwitch]
  )

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

  const effectiveDefaultContent = useMemo(() => {
    if (initialPublicMessageTo) {
      const npub = pubkeyToNpub(initialPublicMessageTo)
      const suffix = defaultContent ? ` ${defaultContent}` : ' '
      return npub ? `nostr:${npub}${suffix}`.trimEnd() : defaultContent
    }
    return defaultContent
  }, [initialPublicMessageTo, defaultContent])

  const composerShell = (
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
      pickerPortalContainer={pickerPortalContainer}
      advancedLabPortalContainer={advancedLabPortalContainer}
      onAdvancedLabOpenChange={handleAdvancedLabOpenChange}
    />
  )

  const advancedLabPortalEl = (
    <div
      ref={setAdvancedLabPortal}
      data-advanced-lab-shell
      className="pointer-events-none fixed inset-0 z-[400] h-[100dvh] w-[100vw] max-h-[100dvh] max-w-[100vw]"
      aria-hidden={!advancedLabOpen}
    />
  )

  const advancedLabPortal =
    bodyPortalReady && typeof document !== 'undefined'
      ? createPortal(advancedLabPortalEl, document.body)
      : null

  const composerHiddenWhileLab = advancedLabOpen

  if (isSmallScreen) {
    return (
      <>
      <Sheet open={open} onOpenChange={handleComposerOpenChange} modal={false}>
        <SheetContent
          className={cn(
            'z-[51] flex w-full max-w-full flex-col border-none bg-background p-0 overflow-hidden data-[state=open]:duration-200 data-[state=closed]:duration-200',
            composerHiddenWhileLab && 'invisible pointer-events-none'
          )}
          style={
            mobileSheetHeightPx != null
              ? { height: mobileSheetHeightPx, maxHeight: mobileSheetHeightPx }
              : { height: 'var(--vh, 100dvh)', maxHeight: 'var(--vh, 100dvh)' }
          }
          side="bottom"
          hideClose
          onInteractOutside={(e) => {
            if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
          }}
          onFocusOutside={(e) => {
            if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (postEditor.isSuggestionPopupOpen) {
              e.preventDefault()
              postEditor.closeSuggestionPopup()
            }
          }}
        >
          <div
            ref={setPickerPortal}
            data-nested-picker-portal
            className="pointer-events-none absolute inset-0 z-[300] overflow-visible"
            aria-hidden={false}
          />
          <div className="relative flex min-h-0 flex-1 flex-col px-4 pt-3 pb-2 min-w-0 overflow-hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Post Editor</SheetTitle>
              <SheetDescription>Create a new post or reply</SheetDescription>
            </SheetHeader>
            {composerShell}
          </div>
        </SheetContent>
      </Sheet>
      {advancedLabPortal}
      </>
    )
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleComposerOpenChange} modal={false}>
      <DialogContent
        className={cn(
          'z-[201] flex h-[min(90dvh,900px)] max-h-[min(90dvh,900px)] flex-col overflow-hidden bg-background p-0 max-w-2xl w-[calc(100vw-2rem)] sm:w-full',
          composerHiddenWhileLab && 'invisible pointer-events-none'
        )}
        overlayClassName={cn('z-[200]', composerHiddenWhileLab && 'invisible pointer-events-none')}
        withoutClose
        onInteractOutside={(e) => {
          if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          if (shouldBlockComposerOutsideDismiss(e.target)) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (postEditor.isSuggestionPopupOpen) {
            e.preventDefault()
            postEditor.closeSuggestionPopup()
          }
        }}
      >
        <div
          ref={setPickerPortal}
          data-nested-picker-portal
          className="pointer-events-none absolute inset-0 z-[300] overflow-visible"
          aria-hidden={false}
        />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-6 pb-4 min-w-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Post Editor</DialogTitle>
              <DialogDescription>Create a new post or reply</DialogDescription>
            </DialogHeader>
            {composerShell}
          </div>
      </DialogContent>
    </Dialog>
    {advancedLabPortal}
    </>
  )
}
