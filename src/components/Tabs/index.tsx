import { cn } from '@/lib/utils'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider' 
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type TabDefinition = {
  value: string
  label: string
  icon?: ReactNode
}

export default function Tabs({
  tabs,
  value,
  onTabChange,
  threshold = 800,
  options = null,
  /** When true, tabs live in layout chrome (subHeader) — no sticky offset or deep-scroll collapse. */
  pinnedToLayout = false
}: {
  tabs: TabDefinition[]
  value: string
  onTabChange?: (tab: string) => void
  threshold?: number
  options?: ReactNode
  pinnedToLayout?: boolean
}) {
  const { t } = useTranslation()
  const { deepBrowsing, lastScrollTop } = useDeepBrowsing()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0, top: 0 })
  const isUpdatingRef = useRef(false)
  const lastStyleRef = useRef({ width: 0, left: 0, top: 0 })

  const updateIndicatorPosition = useCallback(() => {
    // Prevent multiple simultaneous updates
    if (isUpdatingRef.current) return
    
    const activeIndex = tabs.findIndex((tab) => tab.value === value)
    if (activeIndex >= 0 && tabRefs.current[activeIndex] && tabsContainerRef.current) {
      const activeTab = tabRefs.current[activeIndex]
      const tabsContainer = tabsContainerRef.current
      const { offsetWidth, offsetLeft, offsetHeight } = activeTab
      const padding = Math.min(24, Math.max(8, offsetWidth * 0.12))
      
      // Get the container's top position relative to the viewport
      const containerTop = tabsContainer.getBoundingClientRect().top
      const tabTop = activeTab.getBoundingClientRect().top
      
      // Calculate the indicator's top position relative to the container
      // Position it at the bottom of the active tab's row
      const relativeTop = tabTop - containerTop + offsetHeight
      const newWidth = offsetWidth - padding
      const newLeft = offsetLeft + padding / 2
      const newTop = relativeTop - 4 // 4px for the indicator height (1px) + spacing
      
      // Only update if values actually changed
      if (
        lastStyleRef.current.width !== newWidth ||
        lastStyleRef.current.left !== newLeft ||
        lastStyleRef.current.top !== newTop
      ) {
        isUpdatingRef.current = true
        lastStyleRef.current = { width: newWidth, left: newLeft, top: newTop }
        
        setIndicatorStyle({ width: newWidth, left: newLeft, top: newTop })
        
        // Reset flag after state update completes
        requestAnimationFrame(() => {
          isUpdatingRef.current = false
        })
      }
    }
  }, [tabs, value])

  useEffect(() => {
    const animationId = requestAnimationFrame(() => {
      updateIndicatorPosition()
    })

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [updateIndicatorPosition])

  useEffect(() => {
    if (!containerRef.current || !tabsContainerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateIndicatorPosition()
      })
    })

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            requestAnimationFrame(() => {
              updateIndicatorPosition()
            })
          }
        })
      },
      { threshold: 0 }
    )

    intersectionObserver.observe(containerRef.current)

    tabRefs.current.forEach((tab) => {
      if (tab) resizeObserver.observe(tab)
    })
    
    if (tabsContainerRef.current) {
      resizeObserver.observe(tabsContainerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
    }
  }, [updateIndicatorPosition])

  const collapseOnDeepBrowse =
    !pinnedToLayout && deepBrowsing && lastScrollTop > threshold

  return (
    <div
      ref={containerRef}
      className={cn(
        // Single row: flex-nowrap (Firefox grid + w-max/min-w-full wrapped the tool column). Tabs scroll in flex-1.
        'flex w-full min-w-0 flex-nowrap items-end gap-0.5 border-b bg-background px-1 sm:gap-1',
        pinnedToLayout
          ? 'z-10'
          : 'sticky top-12 z-30 transition-transform',
        collapseOnDeepBrowse ? '-translate-y-[calc(100%+12rem)]' : ''
      )}
    >
      <div className="min-h-0 min-w-0 flex-1 basis-0 overflow-x-auto overscroll-x-contain scrollbar-hide">
        <div
          ref={tabsContainerRef}
          role="tablist"
          className="relative inline-flex w-max max-w-none gap-0.5 sm:gap-1"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={value === tab.value}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-center text-xs font-semibold shadow-none transition-colors sm:gap-2 sm:px-3 sm:py-2 sm:text-sm md:px-5 md:text-base',
                'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                value === tab.value ? 'text-foreground' : 'text-muted-foreground'
              )}
              onClick={() => {
                onTabChange?.(tab.value)
              }}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              {t(tab.label)}
            </button>
          ))}
          <div
            className="absolute h-1 rounded-full bg-primary transition-all duration-500"
            style={{
              width: `${indicatorStyle.width}px`,
              left: `${indicatorStyle.left}px`,
              top: `${indicatorStyle.top}px`
            }}
          />
        </div>
      </div>
      {options ? (
        <div className="flex shrink-0 flex-nowrap items-center gap-0 py-1 pl-0.5">{options}</div>
      ) : null}
    </div>
  )
}
