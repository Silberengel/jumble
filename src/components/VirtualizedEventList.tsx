import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, type ReactNode } from 'react'

export type VirtualizedEventListProps = {
  events: Event[]
  estimateSize: number
  overscan?: number
  /** Nearest scrollport (element or window). */
  scrollElement: HTMLElement | Window | null
  renderEvent: (event: Event, index: number) => ReactNode
  className?: string
}

function VirtualizedEventListWindow({
  events,
  estimateSize,
  overscan,
  renderEvent,
  className
}: Omit<VirtualizedEventListProps, 'scrollElement'>) {
  const virtualizer = useWindowVirtualizer({
    count: events.length,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => events[index]?.id ?? index
  })

  useEffect(() => {
    virtualizer.measure()
  }, [events.length, estimateSize, virtualizer])

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
      {items.map((item) => {
        const event = events[item.index]
        if (!event) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
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
    </div>
  )
}

function VirtualizedEventListElement({
  events,
  estimateSize,
  overscan,
  scrollElement,
  renderEvent,
  className
}: VirtualizedEventListProps & { scrollElement: HTMLElement }) {
  const getScrollElement = useCallback(() => scrollElement, [scrollElement])

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => events[index]?.id ?? index
  })

  useEffect(() => {
    virtualizer.measure()
  }, [events.length, estimateSize, virtualizer])

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
      {items.map((item) => {
        const event = events[item.index]
        if (!event) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
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
    </div>
  )
}

/**
 * Viewport-windowed event list. Only mounts rows near the scrollport.
 */
export function VirtualizedEventList({
  events,
  estimateSize,
  overscan = 6,
  scrollElement,
  renderEvent,
  className
}: VirtualizedEventListProps) {
  if (!scrollElement) return null
  if (scrollElement === window || !(scrollElement instanceof HTMLElement)) {
    return (
      <VirtualizedEventListWindow
        events={events}
        estimateSize={estimateSize}
        overscan={overscan}
        renderEvent={renderEvent}
        className={className}
      />
    )
  }
  return (
    <VirtualizedEventListElement
      events={events}
      estimateSize={estimateSize}
      overscan={overscan}
      scrollElement={scrollElement}
      renderEvent={renderEvent}
      className={className}
    />
  )
}
