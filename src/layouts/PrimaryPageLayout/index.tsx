import { ActiveRelaysTitlebarButton } from '@/components/ConnectedRelays/ActiveRelaysTitlebarButton'
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
      subHeader,
      suppressMobileDefaultActiveRelaysButton = false
    }: {
      children?: React.ReactNode
      titlebar: React.ReactNode
      pageName: TPrimaryPageName
      displayScrollToTopButton?: boolean
      hideTitlebarBottomBorder?: boolean
      /** Rendered between titlebar and scroll area; not in scroll flow so it never overlaps content */
      subHeader?: React.ReactNode
      /**
       * When true on small screens, omit the trailing {@link ActiveRelaysTitlebarButton} so the page can
       * place it next to the account control (e.g. feed titlebar).
       */
      suppressMobileDefaultActiveRelaysButton?: boolean
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenScrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenLastScrollTopRef = useRef(0)
    const { isSmallScreen } = useScreenSize()
    const { current, display } = usePrimaryPage()

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
      if (!isSmallScreen) return

      const isVisible = () => {
        return smallScreenScrollAreaRef.current?.checkVisibility
          ? smallScreenScrollAreaRef.current?.checkVisibility()
          : false
      }

      if (isVisible()) {
        window.scrollTo({ top: smallScreenLastScrollTopRef.current, behavior: 'instant' })
      }
      const handleScroll = () => {
        if (isVisible()) {
          smallScreenLastScrollTopRef.current = window.scrollY
        }
      }
      window.addEventListener('scroll', handleScroll)
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }, [current, isSmallScreen, display])

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
              <PrimaryPageTitlebar
                hideBottomBorder={hideTitlebarBottomBorder}
                suppressMobileActiveRelays={suppressMobileDefaultActiveRelaysButton}
              >
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
      <DeepBrowsingProvider active={current === pageName && display} scrollAreaRef={scrollAreaRef}>
        <div className="relative flex h-full min-h-0 min-w-0 flex-col">
          {hasTitlebarRow ? (
            <PrimaryPageTitlebar
              hideBottomBorder={hideTitlebarBottomBorder}
              suppressMobileActiveRelays={false}
            >
              {titlebar}
            </PrimaryPageTitlebar>
          ) : null}
          {subHeader && (
            <div className="min-w-0 shrink-0 bg-background">{subHeader}</div>
          )}
          <div
            ref={scrollAreaRef}
            tabIndex={-1}
            className={
              subHeader
                ? 'min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto'
                : hasTitlebarRow
                  ? 'absolute bottom-0 left-0 right-0 top-12 min-w-0 overflow-y-auto overflow-x-auto'
                  : 'absolute bottom-0 left-0 right-0 top-0 min-w-0 overflow-y-auto overflow-x-auto'
            }
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
  hideBottomBorder = false,
  suppressMobileActiveRelays = false
}: {
  children?: React.ReactNode
  hideBottomBorder?: boolean
  suppressMobileActiveRelays?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  /** Desktop: relay strip lives in the sidebar only. Narrow screens: titlebar control (or inline on feed). */
  const showTrailingActiveRelays = isSmallScreen && !suppressMobileActiveRelays

  return (
    <Titlebar
      className={cn(
        'py-1',
        isSmallScreen ? 'pl-2 pr-[max(0.75rem,env(safe-area-inset-right,0px))]' : 'px-1'
      )}
      hideBottomBorder={hideBottomBorder}
    >
      <div className="flex h-full w-full min-w-0 items-center gap-2">
        <ReadOnlySessionIndicator variant="titlebar" />
        <div className="relative min-h-0 min-w-0 flex-1 h-full">{children}</div>
        {showTrailingActiveRelays ? <ActiveRelaysTitlebarButton /> : null}
      </div>
    </Titlebar>
  )
}
