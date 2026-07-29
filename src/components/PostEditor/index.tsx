import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { ComposerShell } from '@/components/Composer'
import { useSecondaryPageOptional } from '@/PageManager'
import { navigateToComposer } from '@/lib/open-composer'

function isOverlayDismissTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-vaul-drawer-wrapper]'
      )
    )
  )
}

function isNestedPickerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        '[data-advanced-lab-shell], [data-suggestion-popup], [data-nested-picker-portal], [data-gif-picker-shell], [data-gif-picker-root], [data-meme-picker-shell], [data-meme-picker-root], [data-emoji-picker-root], [data-emoji-picker-shell], emoji-picker, [role="alertdialog"]'
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
  const secondaryPage = useSecondaryPageOptional()
  const { isAccountSessionHydrating, isNip07LoginInFlight } = useNostr()
  const [pickerPortalContainer, setPickerPortalContainer] = useState<HTMLElement | null>(null)
  const [advancedLabPortalContainer, setAdvancedLabPortalContainer] = useState<HTMLElement | null>(null)
  const advancedLabPortalRef = useRef<HTMLElement | null>(null)
  const [advancedLabOpen, setAdvancedLabOpen] = useState(false)
  const advancedLabOpenRef = useRef(false)
  const composerDismissGuardUntilRef = useRef(0)
  // Start false so a freshly mounted composer (open=true on first paint) still gets the dismiss guard.
  const prevOpenPropRef = useRef(false)
  const blockDismissForAccountSwitch =
    isAccountSessionHydrating || isNip07LoginInFlight

  if (open && !prevOpenPropRef.current) {
    composerDismissGuardUntilRef.current = performance.now() + 500
  }
  prevOpenPropRef.current = open

  useEffect(() => {
    if (open) {
      composerDismissGuardUntilRef.current = Math.max(
        composerDismissGuardUntilRef.current,
        performance.now() + 500
      )
    }
  }, [open])

  useEffect(() => {
    advancedLabOpenRef.current = advancedLabOpen
  }, [advancedLabOpen])

  const handleAdvancedLabOpenChange = useCallback((next: boolean) => {
    advancedLabOpenRef.current = next
    if (next) {
      composerDismissGuardUntilRef.current = performance.now() + 500
    }
    setAdvancedLabOpen(next)
  }, [])

  const setPickerPortal = useCallback((el: HTMLElement | null) => {
    setPickerPortalContainer(el)
    postEditorService.setSuggestionPopupPortal(el)
  }, [])

  const setAdvancedLabPortal = useCallback((el: HTMLElement | null) => {
    advancedLabPortalRef.current = el
    setAdvancedLabPortalContainer(el)
  }, [])

  useEffect(() => {
    if (!open) handleAdvancedLabOpenChange(false)
  }, [open, handleAdvancedLabOpenChange])

  useEffect(() => {
    return () => postEditorService.setSuggestionPopupPortal(null)
  }, [])

  const handleComposerOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        composerDismissGuardUntilRef.current = performance.now() + 500
      }
      if (!next && advancedLabOpenRef.current) return
      if (!next && performance.now() < composerDismissGuardUntilRef.current) return
      setOpen(next)
    },
    [setOpen]
  )

  const shouldBlockComposerOutsideDismiss = useCallback(
    (target: EventTarget | null) =>
      performance.now() < composerDismissGuardUntilRef.current ||
      advancedLabOpenRef.current ||
      blockDismissForAccountSwitch ||
      isOverlayDismissTarget(target) ||
      isNestedPickerTarget(target),
    [blockDismissForAccountSwitch]
  )

  const effectiveDefaultContent = useMemo(() => {
    if (initialPublicMessageTo) {
      const npub = pubkeyToNpub(initialPublicMessageTo)
      const suffix = defaultContent ? ` ${defaultContent}` : ' '
      return npub ? `nostr:${npub}${suffix}`.trimEnd() : defaultContent
    }
    return defaultContent
  }, [initialPublicMessageTo, defaultContent])

  const mobileRedirectPendingRef = useRef(false)

  useEffect(() => {
    if (!open || !isSmallScreen) {
      mobileRedirectPendingRef.current = false
      return
    }
    const push = secondaryPage?.push
    if (!push) return
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/compose')) {
      setOpen(false)
      return
    }
    if (mobileRedirectPendingRef.current) return
    mobileRedirectPendingRef.current = true

    const navigated = navigateToComposer(push, true, {
      defaultContent: effectiveDefaultContent,
      parentEvent,
      openFrom,
      initialPublicMessageTo
    })
    if (navigated) setOpen(false)
  }, [
    open,
    isSmallScreen,
    secondaryPage,
    effectiveDefaultContent,
    parentEvent,
    openFrom,
    initialPublicMessageTo,
    setOpen
  ])

  useEffect(() => {
    if (!open) return
    postEditorService.setComposerShellOpen(true)
    void preloadEmojiPicker()
    return () => postEditorService.setComposerShellOpen(false)
  }, [open])

  const composerShell = (
    <PostContent
      open={open}
      defaultContent={effectiveDefaultContent}
      parentEvent={parentEvent}
      close={() => {
        if (advancedLabOpenRef.current) return
        setOpen(false)
      }}
      openFrom={openFrom}
      initialHighlightData={initialHighlightData}
      initialPublicMessageTo={initialPublicMessageTo}
      onPublishSuccess={onPublishSuccess}
      discussionDynamicTopics={discussionDynamicTopics}
      pickerPortalContainer={pickerPortalContainer}
      advancedLabPortalContainer={advancedLabPortalContainer}
      advancedLabPortalRef={advancedLabPortalRef}
      onAdvancedLabOpenChange={handleAdvancedLabOpenChange}
      enableAdvancedEditor={!parentEvent}
    />
  )

  const advancedLabPortalEl = (
    <div
      ref={setAdvancedLabPortal}
      data-advanced-lab-shell
      className={cn(
        'fixed inset-0 z-[400] h-[100dvh] w-[100vw] max-h-[100dvh] max-w-[100vw]',
        advancedLabOpen ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      aria-hidden={!advancedLabOpen}
    />
  )

  const advancedLabPortal =
    typeof document !== 'undefined' ? createPortal(advancedLabPortalEl, document.body) : null

  if (isSmallScreen) {
    return null
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleComposerOpenChange} modal={false}>
      <DialogContent
        className="z-[201] flex h-[min(90dvh,900px)] max-h-[min(90dvh,900px)] flex-col overflow-hidden bg-background p-0 max-w-2xl w-[calc(100vw-2rem)] sm:w-full"
        overlayClassName="z-[200]"
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
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden min-w-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Post Editor</DialogTitle>
              <DialogDescription>Create a new post or reply</DialogDescription>
            </DialogHeader>
            <ComposerShell className="min-h-0 flex-1 px-4 pt-6 pb-4">{composerShell}</ComposerShell>
          </div>
      </DialogContent>
    </Dialog>
    {advancedLabPortal}
    </>
  )
}
