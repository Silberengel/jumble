import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function Collapsible({
  alwaysExpand = false,
  children,
  className,
  threshold = 1000,
  collapsedHeight = 600,
  ...props
}: {
  alwaysExpand?: boolean
  threshold?: number
  collapsedHeight?: number
} & React.HTMLProps<HTMLDivElement>) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [shouldCollapse, setShouldCollapse] = useState(false)

  useEffect(() => {
    if (alwaysExpand || shouldCollapse) return

    const contentEl = containerRef.current
    if (!contentEl) return

    const checkHeight = () => {
      const fullHeight = contentEl.scrollHeight
      if (fullHeight > threshold) {
        setShouldCollapse(true)
      }
    }

    checkHeight()

    const observer = new ResizeObserver(() => {
      checkHeight()
    })

    observer.observe(contentEl)

    return () => {
      observer.disconnect()
    }
  }, [alwaysExpand, shouldCollapse])

  return (
    <div
      className={cn('relative text-left', className)}
      ref={containerRef}
      {...props}
      style={{
        maxHeight: !shouldCollapse || expanded ? 'none' : `${collapsedHeight}px`,
        overflow: !shouldCollapse || expanded ? 'visible' : 'hidden'
      }}
    >
      {children}
      {shouldCollapse && !expanded && (
        <div
          className="pointer-events-none absolute bottom-0 z-20 flex h-40 w-full items-end justify-center bg-gradient-to-b from-transparent to-background/90 pb-4"
          data-collapsible-show-more
        >
          <div className="pointer-events-auto rounded-md">
            <Button
              className="bg-foreground text-background hover:bg-foreground/90 hover:text-background"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(!expanded)
              }}
            >
              {t('Show more')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
