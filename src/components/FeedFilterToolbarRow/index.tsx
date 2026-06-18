import { FeedRelaysIconRow } from '@/components/FeedRelaysIconRow'
import KindFilter from '@/components/KindFilter'
import { RefreshButton } from '@/components/RefreshButton'
import { cn } from '@/lib/utils'
import type { Ref } from 'react'

/** Sticky/subheader chrome around the feed tool row (home subHeader, in-feed sticky). */
export const feedFilterRowChromeClass =
  'w-full min-w-0 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80'

/**
 * Single-row feed controls: refresh (optional), kind filter, and 🔍 slot (portaled from {@link NoteList}).
 * Use `flex-nowrap` so large text / narrow viewports do not wrap tools onto a second line.
 */
export default function FeedFilterToolbarRow({
  showKinds,
  onShowKindsChange,
  onRefresh,
  feedFilterTabRowSlotRef,
  includeFeedSearchSlot = false,
  relayUrls,
  className
}: {
  showKinds: number[]
  onShowKindsChange: (kinds: number[]) => void
  onRefresh?: () => void
  /** Host element for {@link NoteList} feed-client-filter toggle via portal. */
  feedFilterTabRowSlotRef?: Ref<HTMLDivElement>
  includeFeedSearchSlot?: boolean
  /** Relays queried by this feed (home feed without {@link NoteList}). */
  relayUrls?: readonly string[]
  className?: string
}) {
  const showRelayToolbar = (relayUrls?.length ?? 0) > 0 || includeFeedSearchSlot

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-nowrap items-center justify-end gap-0 py-1',
        className
      )}
    >
      {onRefresh != null ? <RefreshButton onClick={onRefresh} /> : null}
      <KindFilter showKinds={showKinds} onShowKindsChange={onShowKindsChange} />
      {showRelayToolbar ? (
        <div
          ref={feedFilterTabRowSlotRef}
          className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1 overflow-hidden"
        >
          {relayUrls?.length ? (
            <FeedRelaysIconRow
              urls={relayUrls}
              compact
              className="min-w-0 flex-1 overflow-x-auto scrollbar-hide"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
