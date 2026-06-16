import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'

const SHOW_ABOVE_PX = 800

export default function ScrollToTopButton({
  scrollAreaRef,
  className
}: {
  scrollAreaRef?: React.RefObject<HTMLDivElement>
  className?: string
}) {
  const { isSmallScreen } = useScreenSize()
  const { deepBrowsing, getLastScrollTop } = useDeepBrowsing()
  const [scrollTopVisible, setScrollTopVisible] = useState(() => getLastScrollTop() > SHOW_ABOVE_PX)

  useEffect(() => {
    const readTop = () =>
      scrollAreaRef?.current != null ? scrollAreaRef.current.scrollTop : window.scrollY

    const syncVisibility = () => {
      const top = readTop()
      setScrollTopVisible((prev) => {
        const next = top > SHOW_ABOVE_PX
        return prev === next ? prev : next
      })
    }

    syncVisibility()
    const target: HTMLElement | Window = scrollAreaRef?.current ?? window
    let rafId = 0
    const onScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        syncVisibility()
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [scrollAreaRef])

  const visible = !deepBrowsing && scrollTopVisible

  const handleScrollToTop = () => {
    if (!scrollAreaRef) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div
      className={cn(
        `fixed sm:sticky z-30 flex justify-end w-full pr-3 pointer-events-none transition-opacity duration-700 ${visible ? '' : 'opacity-0'}`,
        className
      )}
      style={{
        bottom: isSmallScreen
          ? 'calc(env(safe-area-inset-bottom) + 3.75rem)'
          : 'calc(env(safe-area-inset-bottom) + 0.75rem)',
        willChange: 'opacity' // Hint to browser for better scroll performance
      }}
    >
      <Button
        variant="secondary-2"
        className="rounded-full w-12 h-12 p-0 hover:text-background pointer-events-auto disabled:pointer-events-none"
        onClick={handleScrollToTop}
        disabled={!visible}
      >
        <ChevronUp />
      </Button>
    </div>
  )
}
