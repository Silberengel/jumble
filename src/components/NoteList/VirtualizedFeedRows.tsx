import NoteCard from '@/components/NoteCard'
import MediaGridItem from '@/components/MediaGridItem'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Event } from 'nostr-tools'
import { memo } from 'react'

const ESTIMATE_NOTE_ROW_PX = 280
const ESTIMATE_GRID_ROW_PX = 120
const VIRTUAL_OVERSCAN = 10

export type VirtualizedFeedRowsProps = {
  events: Event[]
  gridLayout: boolean
  filterMutedNotes: boolean
  eventReasonLabelMap: Map<string, string>
  /** When true, list scrolls with `window`; otherwise `scrollElement` must be set. */
  useWindowScroll: boolean
  scrollElement: HTMLElement | null
  /** Document offset of the list root (window virtualizer scroll margin). */
  scrollMarginTop: number
}

const WindowRows = memo(function WindowRows({
  events,
  gridLayout,
  filterMutedNotes,
  eventReasonLabelMap,
  scrollMarginTop
}: Omit<VirtualizedFeedRowsProps, 'useWindowScroll' | 'scrollElement'>) {
  const rowCount = gridLayout ? Math.ceil(events.length / 3) : events.length
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => (gridLayout ? ESTIMATE_GRID_ROW_PX : ESTIMATE_NOTE_ROW_PX),
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin: scrollMarginTop,
    getItemKey: (index) => (gridLayout ? `grid-${index}` : (events[index]?.id ?? `i-${index}`))
  })

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${vi.start}px)` }}
        >
          {gridLayout ? (
            <div className="grid grid-cols-3 gap-0.5 pr-4">
              {events.slice(vi.index * 3, vi.index * 3 + 3).map((event) => (
                <MediaGridItem key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <NoteCard
              className="w-full"
              event={events[vi.index]!}
              filterMutedNotes={filterMutedNotes}
              bottomNoteLabel={eventReasonLabelMap.get(events[vi.index]!.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
})

const ElementRows = memo(function ElementRows({
  events,
  gridLayout,
  filterMutedNotes,
  eventReasonLabelMap,
  scrollElement
}: Omit<VirtualizedFeedRowsProps, 'useWindowScroll' | 'scrollMarginTop'> & {
  scrollElement: HTMLElement
}) {
  const rowCount = gridLayout ? Math.ceil(events.length / 3) : events.length
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => (gridLayout ? ESTIMATE_GRID_ROW_PX : ESTIMATE_NOTE_ROW_PX),
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => (gridLayout ? `grid-${index}` : (events[index]?.id ?? `i-${index}`))
  })

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${vi.start}px)` }}
        >
          {gridLayout ? (
            <div className="grid grid-cols-3 gap-0.5 pr-4">
              {events.slice(vi.index * 3, vi.index * 3 + 3).map((event) => (
                <MediaGridItem key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <NoteCard
              className="w-full"
              event={events[vi.index]!}
              filterMutedNotes={filterMutedNotes}
              bottomNoteLabel={eventReasonLabelMap.get(events[vi.index]!.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
})

/** Window- or element-scrolling virtual list for feed rows (and 3-column media grid by row). */
export default memo(function VirtualizedFeedRows({
  events,
  gridLayout,
  filterMutedNotes,
  eventReasonLabelMap,
  useWindowScroll,
  scrollElement,
  scrollMarginTop
}: VirtualizedFeedRowsProps) {
  if (events.length === 0) {
    return null
  }

  if (useWindowScroll) {
    return (
      <WindowRows
        events={events}
        gridLayout={gridLayout}
        filterMutedNotes={filterMutedNotes}
        eventReasonLabelMap={eventReasonLabelMap}
        scrollMarginTop={scrollMarginTop}
      />
    )
  }

  if (!scrollElement) {
    return null
  }

  return (
    <ElementRows
      events={events}
      gridLayout={gridLayout}
      filterMutedNotes={filterMutedNotes}
      eventReasonLabelMap={eventReasonLabelMap}
      scrollElement={scrollElement}
    />
  )
})
