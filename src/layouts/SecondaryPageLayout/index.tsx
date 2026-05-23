import { ActiveRelaysTitlebarButton } from '@/components/ConnectedRelays/ActiveRelaysTitlebarButton'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'
import { Titlebar } from '@/components/Titlebar'
import { Button } from '@/components/ui/button'
import {
  FOCUS_SECONDARY_SCROLL_SHORTCUT_KEY,
  isRadixDialogOpen,
  shouldIgnoreKeyboardShortcutEvent
} from '@/lib/keyboard-shortcuts'
import { useMobileSwipeBackOnElement } from '@/lib/mobile-swipe-back'
import { useSecondaryPage } from '@/PageManager'
import { DeepBrowsingProvider } from '@/providers/DeepBrowsingProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { cn } from '@/lib/utils'
import { ChevronLeft } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SecondaryPageLayout = forwardRef(
  (
    {
      children,
      index,
      title,
      controls,
      hideBackButton = false,
      hideTitlebarBottomBorder = false,
      displayScrollToTopButton = false,
      titlebar
    }: {
      children?: React.ReactNode
      index?: number
      title?: React.ReactNode
      controls?: React.ReactNode
      hideBackButton?: boolean
      hideTitlebarBottomBorder?: boolean
      displayScrollToTopButton?: boolean
      titlebar?: React.ReactNode
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const { isSmallScreen } = useScreenSize()
    const { currentIndex, pop } = useSecondaryPage()
    const [mobileSwipeRoot, setMobileSwipeRoot] = useState<HTMLElement | null>(null)
    const mobileSwipeActive =
      isSmallScreen && (index === undefined || currentIndex === index)
    useMobileSwipeBackOnElement(mobileSwipeActive ? mobileSwipeRoot : null, pop, {
      enabled: mobileSwipeActive
    })

    const shouldRenderTitlebar =
      titlebar != null || (title != null && title !== '') || !hideBackButton

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
      if (isSmallScreen) {
        setTimeout(() => window.scrollTo({ top: 0 }), 10)
        return
      }
    }, [])

    useEffect(() => {
      if (isSmallScreen) return
      if (currentIndex !== index) return

      const onKeyDown = (e: KeyboardEvent) => {
        if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== FOCUS_SECONDARY_SCROLL_SHORTCUT_KEY) return
        if (e.metaKey || e.ctrlKey) return
        if (shouldIgnoreKeyboardShortcutEvent(e.target)) return
        if (isRadixDialogOpen()) return

        e.preventDefault()
        scrollAreaRef.current?.focus({ preventScroll: true })
      }

      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [isSmallScreen, currentIndex, index])

    if (isSmallScreen) {
      return (
        <DeepBrowsingProvider active={currentIndex === index}>
          <div
            ref={setMobileSwipeRoot}
            className="flex min-h-0 min-w-0 flex-1 flex-col touch-pan-y"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)'
            }}
          >
            {shouldRenderTitlebar ? (
              <SecondaryPageTitlebar
                title={title}
                controls={controls}
                hideBackButton={hideBackButton}
                hideBottomBorder={hideTitlebarBottomBorder}
                titlebar={titlebar}
                sticky={isSmallScreen}
              />
            ) : null}
            {children}
          </div>
          {displayScrollToTopButton && <ScrollToTopButton />}
        </DeepBrowsingProvider>
      )
    }

    return (
      <DeepBrowsingProvider active={currentIndex === index} scrollAreaRef={scrollAreaRef}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {shouldRenderTitlebar ? (
            <SecondaryPageTitlebar
              title={title}
              controls={controls}
              hideBackButton={hideBackButton}
              hideBottomBorder={hideTitlebarBottomBorder}
              titlebar={titlebar}
            />
          ) : null}
          <div
            ref={scrollAreaRef}
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto"
          >
            {children}
            <div className="h-12" />
          </div>
        </div>
        {displayScrollToTopButton && <ScrollToTopButton scrollAreaRef={scrollAreaRef} />}
      </DeepBrowsingProvider>
    )
  }
)
SecondaryPageLayout.displayName = 'SecondaryPageLayout'
export default SecondaryPageLayout

function SecondaryPageTitlebar({
  title,
  controls,
  hideBackButton = false,
  hideBottomBorder = false,
  titlebar,
  sticky = false
}: {
  title?: React.ReactNode
  controls?: React.ReactNode
  hideBackButton?: boolean
  hideBottomBorder?: boolean
  titlebar?: React.ReactNode
  /** Keep back visible while the page scrolls (mobile secondary stack). */
  sticky?: boolean
}): JSX.Element {
  const { isSmallScreen } = useScreenSize()
  const { t } = useTranslation()
  const titlebarInset = isSmallScreen
    ? 'py-1 pl-2 pr-[max(0.75rem,env(safe-area-inset-right,0px))]'
    : 'p-1'
  const stickyClass = sticky
    ? 'sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'
    : ''

  if (titlebar) {
    return (
      <Titlebar
        className={cn(titlebarInset, stickyClass)}
        hideBottomBorder={hideBottomBorder}
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <ReadOnlySessionIndicator variant="titlebar" />
          <div className="min-w-0 flex-1">{titlebar}</div>
          {isSmallScreen ? <ActiveRelaysTitlebarButton /> : null}
        </div>
      </Titlebar>
    )
  }
  return (
    <Titlebar
      className={cn(titlebarInset, stickyClass)}
      hideBottomBorder={hideBottomBorder}
    >
      <div className="flex w-full min-w-0 items-center gap-2 font-semibold">
        <ReadOnlySessionIndicator variant="titlebar" />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-1">
          {hideBackButton ? (
            title ? (
              <div className="app-chrome-title flex w-fit items-center gap-2 truncate pl-2">
                {title}
              </div>
            ) : null
          ) : (
            <div className="flex min-w-0 items-center">
              <BackButton>{title ?? t('back')}</BackButton>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5 min-w-0 max-w-[min(100%,14rem)] sm:max-w-none">
            {controls}
          </div>
        </div>
        {isSmallScreen ? <ActiveRelaysTitlebarButton /> : null}
      </div>
    </Titlebar>
  )
}

function BackButton({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()

  return (
    <Button
      className="flex gap-1 items-center w-fit max-w-full justify-start pl-2 pr-3"
      variant="ghost"
      size="titlebar-icon"
      title={t('back')}
      onClick={() => pop()}
    >
      <ChevronLeft />
              <div className="app-chrome-title truncate">{children}</div>
    </Button>
  )
}
