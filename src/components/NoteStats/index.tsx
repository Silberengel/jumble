import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNearViewport } from '@/hooks/useNearViewport'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useRssUrlThreadQueryRelays } from '@/hooks/useRssUrlThreadQueryRelays'
import noteStatsService from '@/services/note-stats.service'
import { ExtendedKind } from '@/constants'
import { useReplyUnderDiscussionRoot } from '@/hooks/useReplyUnderDiscussionRoot'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { Event } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import BookmarkButton from '../BookmarkButton'
import NotificationThreadWatchButtons from '../NotificationThreadWatchButtons'
import { LikeButtonWithStats } from './LikeButton'
import { ReplyButtonWithStats } from './ReplyButton'
import { RepostButtonWithStats } from './RepostButton'
import SeenOnButton from './SeenOnButton'
import { ZapButtonWithStats } from './ZapButton'

export default function NoteStats({
  event,
  className,
  classNames,
  fetchIfNotExisting = false,
  foregroundStats = false,
  deferFetchUntilNearViewport,
  useIconOnlyLikeTrigger = false
}: {
  event: Event
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
  /** Jump ahead of spell-feed backlog so counts resolve on the open note / article. */
  foregroundStats?: boolean
  /**
   * When true, {@link fetchNoteStats} waits until the stats row is near the viewport.
   * Defaults to on for feed cards (`fetchIfNotExisting` && !`foregroundStats`).
   */
  deferFetchUntilNearViewport?: boolean
  /**
   * Thread rows for kind-7 reactions: like control shows icon + total only (body already shows the reaction glyph).
   */
  useIconOnlyLikeTrigger?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const noteStats = useNoteStatsById(event.id)
  const { relays: hintRelays, currentRelaysKey } = useNoteStatsRelayHints()
  const { relayUrls: rssUrlThreadRelays, relayMergeTier } = useRssUrlThreadQueryRelays()
  const [loading, setLoading] = useState(false)
  
  // Hide boost button for discussion events and replies to discussions
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const isReplyToDiscussion = useReplyUnderDiscussionRoot(event)
  
  // Hide interaction counts if event is in quiet mode
  const hideInteractions = shouldHideInteractions(event)

  /** Synthetic RSS article root: no boost/quote/zap bar entries that normal notes have. */
  const isRssArticleRoot = event.kind === ExtendedKind.RSS_THREAD_ROOT
  /** Match {@link RssUrlThreadStatsBar}: inbox/favorites/fast-read merge — plain hints miss many #i indexers. */
  const statsRelays = isRssArticleRoot ? rssUrlThreadRelays : hintRelays
  /** At most two background refetches per card: before vs after inbox/favorite hints hydrate. */
  const statsRelayFetchTier = isRssArticleRoot ? relayMergeTier : hintRelays.length > 0 ? 1 : 0
  const statsRelaysRef = useRef(statsRelays)
  statsRelaysRef.current = statsRelays
  const isZapPoll = event.kind === ExtendedKind.ZAP_POLL

  const shouldDeferStatsFetch =
    deferFetchUntilNearViewport ?? (fetchIfNotExisting && !foregroundStats)
  const containerRef = useRef<HTMLDivElement>(null)
  const isNearViewport = useNearViewport(containerRef, { enabled: shouldDeferStatsFetch })

  useEffect(() => {
    if (!fetchIfNotExisting) return
    if (shouldDeferStatsFetch && !isNearViewport) return
    setLoading(true)
    noteStatsService
      .fetchNoteStats(event, pubkey, statsRelaysRef.current, { foreground: foregroundStats })
      .finally(() => setLoading(false))
    // Intentionally omit `event` object: parent feeds often pass new references each render;
    // id/sig/kind/created_at identify the note for refetch boundaries.
    // `statsRelayFetchTier` (not full sorted relay key) avoids a REQ storm when favorites/current relays hydrate.
  }, [
    event.id,
    event.kind,
    event.created_at,
    event.sig,
    fetchIfNotExisting,
    foregroundStats,
    shouldDeferStatsFetch,
    isNearViewport,
    pubkey,
    statsRelayFetchTier,
    currentRelaysKey
  ])

  if (isSmallScreen) {
    return (
      <div
        ref={containerRef}
        className={cn('select-none', className)}
        data-note-stats
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex justify-between items-center h-5 [&_svg]:size-5',
            loading ? 'animate-pulse' : '',
            classNames?.buttonBar
          )}
        >
          <ReplyButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          {!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot && (
            <RepostButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          )}
          <LikeButtonWithStats
            event={event}
            hideCount={hideInteractions}
            noteStats={noteStats}
            isReplyToDiscussion={isReplyToDiscussion}
            useIconOnlyLikeTrigger={useIconOnlyLikeTrigger}
          />
          {!isRssArticleRoot && !isZapPoll && (
            <ZapButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          )}
          {!isRssArticleRoot && <NotificationThreadWatchButtons event={event} />}
          {!isRssArticleRoot && <BookmarkButton event={event} />}
          <SeenOnButton event={event} />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('select-none', className)}
      data-note-stats
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between h-5 [&_svg]:size-4">
        <div
          className={cn('flex items-center', loading ? 'animate-pulse' : '')}
        >
          <ReplyButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          {!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot && (
            <RepostButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          )}
          <LikeButtonWithStats
            event={event}
            hideCount={hideInteractions}
            noteStats={noteStats}
            isReplyToDiscussion={isReplyToDiscussion}
            useIconOnlyLikeTrigger={useIconOnlyLikeTrigger}
          />
          {!isRssArticleRoot && !isZapPoll && (
            <ZapButtonWithStats event={event} hideCount={hideInteractions} noteStats={noteStats} />
          )}
        </div>
        <div className="flex items-center">
          {!isRssArticleRoot && <NotificationThreadWatchButtons event={event} />}
          {!isRssArticleRoot && <BookmarkButton event={event} />}
          <SeenOnButton event={event} />
        </div>
      </div>
    </div>
  )
}
