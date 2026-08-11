import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Event } from 'nostr-tools'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

export type VirtualizedEventListProps = {
  events: Event[]
  estimateSize: number
  overscan?: number
  /** Nearest scrollport (element or window). */
  scrollElement: HTMLElement | Window | null
  renderEvent: (event: Event, index: number) => ReactNode
  className?: string
}

/**
 * Distance from the top of the scroll content to the list root. Required when pins / headers
 * sit above the list in the same scrollport — without it, scrollTop is misread as list offset
 * and early rows are skipped (giant empty gap under pins).
 */
function measureScrollMargin(
  listEl: HTMLElement,
  scrollElement: HTMLElement | Window
): number {
  if (scrollElement === window) {
    const rect = listEl.getBoundingClientRect()
    return Math.max(0, Math.round(rect.top + window.scrollY))
  }
  const scroller = scrollElement as HTMLElement
  const listRect = listEl.getBoundingClientRect()
  const scrollRect = scroller.getBoundingClientRect()
  return Math.max(0, Math.round(listRect.top - scrollRect.top + scroller.scrollTop))
}

function useScrollMargin(
  listRef: React.RefObject<HTMLDivElement | null>,
  scrollElement: HTMLElement | Window | null,
  /** Re-measure when list content / layout above may change. */
  layoutKey: string | number
): number {
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const listEl = listRef.current
    if (!listEl || !scrollElement) {
      setScrollMargin(0)
      return
    }

    const update = () => {
      const next = measureScrollMargin(listEl, scrollElement)
      setScrollMargin((prev) => (Math.abs(prev - next) > 1 ? next : prev))
    }
    update()

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null
    ro?.observe(listEl)
    if (listEl.parentElement) ro?.observe(listEl.parentElement)
    if (scrollElement !== window) {
      ro?.observe(scrollElement as HTMLElement)
    }
    // Pins / profile header above the list change offset without resizing the list itself.
    const scrollTarget: HTMLElement | Window =
      scrollElement === window ? window : (scrollElement as HTMLElement)
    scrollTarget.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const t0 = window.setTimeout(update, 0)
    const t1 = window.setTimeout(update, 100)
    return () => {
      ro?.disconnect()
      scrollTarget.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.clearTimeout(t0)
      window.clearTimeout(t1)
    }
  }, [listRef, scrollElement, layoutKey])

  return scrollMargin
}

function VirtualRows({
  items,
  events,
  measureElement,
  renderEvent
}: {
  items: { key: string | number | bigint; index: number; start: number }[]
  events: Event[]
  measureElement: (node: Element | null) => void
  renderEvent: (event: Event, index: number) => ReactNode
}) {
  return (
    <>
      {items.map((item) => {
        const event = events[item.index]
        if (!event) return null
        return (
          <div
            key={String(item.key)}
            data-index={item.index}
            ref={measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`
            }}
          >
            {renderEvent(event, item.index)}
          </div>
        )
      })}
    </>
  )
}

function VirtualizedEventListWindow({
  events,
  estimateSize,
  overscan,
  renderEvent,
  className,
  scrollMargin
}: Omit<VirtualizedEventListProps, 'scrollElement'> & { scrollMargin: number }) {
  const virtualizer = useWindowVirtualizer({
    count: events.length,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    getItemKey: (index) => events[index]?.id ?? index
  })

  const items = virtualizer.getVirtualItems()

  return (
    <div
      className={className}
      style={{
        // getTotalSize() already subtracts scrollMargin
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative'
      }}
    >
      <VirtualRows
        items={items.map((item) => ({
          key: item.key,
          index: item.index,
          start: item.start - scrollMargin
        }))}
        events={events}
        measureElement={virtualizer.measureElement}
        renderEvent={renderEvent}
      />
    </div>
  )
}

function VirtualizedEventListElement({
  events,
  estimateSize,
  overscan,
  scrollElement,
  renderEvent,
  className,
  scrollMargin
}: VirtualizedEventListProps & { scrollElement: HTMLElement; scrollMargin: number }) {
  const getScrollElement = useCallback(() => scrollElement, [scrollElement])

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    getItemKey: (index) => events[index]?.id ?? index
  })

  const items = virtualizer.getVirtualItems()

  return (
    <div
      className={className}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative'
      }}
    >
      <VirtualRows
        items={items.map((item) => ({
          key: item.key,
          index: item.index,
          start: item.start - scrollMargin
        }))}
        events={events}
        measureElement={virtualizer.measureElement}
        renderEvent={renderEvent}
      />
    </div>
  )
}

/**
 * Viewport-windowed event list. Only mounts rows near the scrollport.
 * Uses {@link scrollMargin} when the list is below headers/pins in the same scroller.
 */
export function VirtualizedEventList({
  events,
  estimateSize,
  overscan = 6,
  scrollElement,
  renderEvent,
  className
}: VirtualizedEventListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const layoutKey = `${events.length}:${events[0]?.id ?? ''}:${events[events.length - 1]?.id ?? ''}`
  const scrollMargin = useScrollMargin(listRef, scrollElement, layoutKey)

  if (!scrollElement) return null

  return (
    <div ref={listRef} className="min-w-0">
      {scrollElement === window || !(scrollElement instanceof HTMLElement) ? (
        <VirtualizedEventListWindow
          events={events}
          estimateSize={estimateSize}
          overscan={overscan}
          renderEvent={renderEvent}
          className={className}
          scrollMargin={scrollMargin}
        />
      ) : (
        <VirtualizedEventListElement
          events={events}
          estimateSize={estimateSize}
          overscan={overscan}
          scrollElement={scrollElement}
          renderEvent={renderEvent}
          className={className}
          scrollMargin={scrollMargin}
        />
      )}
    </div>
  )
}
