import HelpAndAccountMenu from '@/components/HelpAndAccountMenu'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'
import { Titlebar } from '@/components/Titlebar'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import type { TPrimaryPageName } from '@/PageManager'
import { DeepBrowsingProvider } from '@/providers/DeepBrowsingProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import {
  FOCUS_PRIMARY_SCROLL_SHORTCUT_KEY,
  isRadixDialogOpen,
  shouldIgnoreKeyboardShortcutEvent
} from '@/lib/keyboard-shortcuts'
import {
  peekMobilePrimaryFeedScroll,
  saveMobilePrimaryFeedScroll
} from '@/lib/mobile-primary-feed-scroll'
import { cn } from '@/lib/utils'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const PrimaryPageLayout = forwardRef(
  (
    {
      children,
      titlebar,
      pageName,
      displayScrollToTopButton = false,
      hideTitlebarBottomBorder = false,
      subHeader
    }: {
      children?: React.ReactNode
      titlebar: React.ReactNode
      pageName: TPrimaryPageName
      displayScrollToTopButton?: boolean
      hideTitlebarBottomBorder?: boolean
      /** Rendered between titlebar and scroll area; not in scroll flow so it never overlaps content */
      subHeader?: React.ReactNode
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenScrollAreaRef = useRef<HTMLDivElement>(null)
    const { isSmallScreen } = useScreenSize()
    const { current, display, frozen } = usePrimaryPage()
    const savedScrollTopRef = useRef(0)
    const wasFrozenRef = useRef(false)

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop: (behavior: ScrollBehavior = 'smooth') => {
          setTimeout(() => {
            if (scrollAreaRef.current) {
              return scrollAreaRef.current.scrollTo({ top: 0, behavior })
            }
            window.scrollTo({ top: 0, behavior })
          }, 10)
        }
      }),
      []
    )

    useEffect(() => {
      if (!isSmallScreen || current !== pageName) return

      const handleScroll = () => {
        saveMobilePrimaryFeedScroll(pageName, window.scrollY)
      }
      window.addEventListener('scroll', handleScroll, { passive: true })
      return () => {
        handleScroll()
        window.removeEventListener('scroll', handleScroll)
      }
    }, [current, isSmallScreen, pageName])

    useEffect(() => {
      if (!isSmallScreen || current !== pageName || !display) return
      const top = peekMobilePrimaryFeedScroll(pageName)
      requestAnimationFrame(() => {
        window.scrollTo({ top, behavior: 'instant' })
      })
    }, [current, display, isSmallScreen, pageName])

    useEffect(() => {
      if (isSmallScreen) return
      const el = scrollAreaRef.current
      if (!el) return

      if (frozen && !wasFrozenRef.current) {
        savedScrollTopRef.current = el.scrollTop
        wasFrozenRef.current = true
        return
      }

      if (!frozen && wasFrozenRef.current) {
        wasFrozenRef.current = false
        const top = savedScrollTopRef.current
        requestAnimationFrame(() => {
          if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTop = top
          }
        })
      }
    }, [frozen, isSmallScreen, pageName])

    useEffect(() => {
      if (isSmallScreen) return
      if (current !== pageName || !display) return

      const onKeyDown = (e: KeyboardEvent) => {
        if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== FOCUS_PRIMARY_SCROLL_SHORTCUT_KEY) return
        if (e.metaKey || e.ctrlKey) return
        if (shouldIgnoreKeyboardShortcutEvent(e.target)) return
        if (isRadixDialogOpen()) return

        e.preventDefault()
        scrollAreaRef.current?.focus({ preventScroll: true })
      }

      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [isSmallScreen, current, pageName, display])

    const hasTitlebarRow = titlebar != null

    if (isSmallScreen) {
      return (
        <DeepBrowsingProvider active={current === pageName && display}>
          <div
            ref={smallScreenScrollAreaRef}
            className="min-w-0 w-full overflow-x-hidden"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)'
            }}
          >
            {hasTitlebarRow ? (
              <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
                {titlebar}
              </PrimaryPageTitlebar>
            ) : null}
            {subHeader && <div className="shrink-0 w-full min-w-0 bg-background">{subHeader}</div>}
            <div className="min-w-0 w-full">
              {children}
            </div>
          </div>
          {displayScrollToTopButton && <ScrollToTopButton />}
        </DeepBrowsingProvider>
      )
    }

    return (
      <DeepBrowsingProvider
        active={current === pageName && display && !frozen}
        scrollAreaRef={scrollAreaRef}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {hasTitlebarRow ? (
            <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
              {titlebar}
            </PrimaryPageTitlebar>
          ) : null}
          {subHeader && (
            <div className="min-w-0 shrink-0 bg-background">{subHeader}</div>
          )}
          <div
            ref={scrollAreaRef}
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto"
          >
            {children}
            <div className="h-4" />
          </div>
        </div>
        {displayScrollToTopButton && <ScrollToTopButton scrollAreaRef={scrollAreaRef} />}
      </DeepBrowsingProvider>
    )
  }
)
PrimaryPageLayout.displayName = 'PrimaryPageLayout'
export default PrimaryPageLayout

export type TPrimaryPageLayoutRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
}

function PrimaryPageTitlebar({
  children,
  hideBottomBorder = false
}: {
  children?: React.ReactNode
  hideBottomBorder?: boolean
}) {
  const { isSmallScreen } = useScreenSize()

  return (
    <Titlebar
      className={cn(
        isSmallScreen ? 'pl-2 pr-[max(0.75rem,env(safe-area-inset-right,0px))]' : 'px-1'
      )}
      hideBottomBorder={hideBottomBorder}
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        <ReadOnlySessionIndicator variant="titlebar" />
        <div className="relative min-w-0 flex-1">{children}</div>
        {isSmallScreen ? <HelpAndAccountMenu variant="titlebar" /> : null}
      </div>
    </Titlebar>
  )
}
