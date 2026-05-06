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

  const collapsed = shouldCollapse && !expanded

  return (
    <div className={cn('text-left', className)} {...props}>
      <div
        ref={containerRef}
        style={{
          maxHeight: !shouldCollapse || expanded ? 'none' : `${collapsedHeight}px`,
          overflow: !shouldCollapse || expanded ? 'visible' : 'hidden'
        }}
      >
        {children}
      </div>
      {collapsed ? (
        <div className="bg-background" data-collapsible-show-more>
          <div
            aria-hidden
            className="pointer-events-none h-7 w-full bg-gradient-to-b from-transparent to-background"
          />
          <div className="flex justify-center px-2 pb-2 pt-1">
            <Button
              type="button"
              className="bg-foreground text-background hover:bg-foreground/90 hover:text-background"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
            >
              {t('Show more')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
