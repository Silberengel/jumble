import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useNearViewport } from '@/hooks/useNearViewport'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useRssUrlThreadQueryRelays } from '@/hooks/useRssUrlThreadQueryRelays'
import noteStatsService from '@/services/note-stats.service'
import { ExtendedKind } from '@/constants'
import { useReplyUnderDiscussionRoot } from '@/hooks/useReplyUnderDiscussionRoot'
import { normalizeAnyRelayUrl } from '@/lib/url'
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
  useIconOnlyLikeTrigger = false,
  /** Home feed: stats + “Seen on” only use these relays (favorites + trending, or reply widen stack). */
  seenOnAllowlist
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
  seenOnAllowlist?: readonly string[]
}) {
  const { pubkey } = useNostr()
  const noteStats = useNoteStatsById(event.id)
  const { relays: hintRelays, currentRelaysKey } = useNoteStatsRelayHints()
  const { relayUrls: rssUrlThreadRelays, relayMergeTier } = useRssUrlThreadQueryRelays()
  const [loading, setLoading] = useState(false)

  // Hide boost button for discussion events and replies to discussions
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const isReplyToDiscussion = useReplyUnderDiscussionRoot(event)

  /** Synthetic RSS article root: no boost/quote/zap bar entries that normal notes have. */
  const isRssArticleRoot = event.kind === ExtendedKind.RSS_THREAD_ROOT
  /** Match {@link RssUrlThreadStatsBar}: inbox/favorites/fast-read merge — plain hints miss many #i indexers. */
  const statsRelays = isRssArticleRoot
    ? rssUrlThreadRelays
    : seenOnAllowlist?.length
      ? seenOnAllowlist
      : hintRelays
  /** At most two background refetches per card: before vs after inbox/favorite hints hydrate. */
  const statsRelayFetchTier = isRssArticleRoot ? relayMergeTier : hintRelays.length > 0 ? 1 : 0
  const statsRelaysRef = useRef(statsRelays)
  statsRelaysRef.current = statsRelays
  const seenOnAllowlistRef = useRef(seenOnAllowlist)
  seenOnAllowlistRef.current = seenOnAllowlist
  const seenOnAllowlistKey = seenOnAllowlist?.length
    ? [...seenOnAllowlist]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|')
    : ''
  const shouldDeferStatsFetch =
    deferFetchUntilNearViewport ?? (fetchIfNotExisting && !foregroundStats)
  const containerRef = useRef<HTMLDivElement>(null)
  const isNearViewport = useNearViewport(containerRef, { enabled: shouldDeferStatsFetch })

  useEffect(() => {
    if (!fetchIfNotExisting) return
    if (shouldDeferStatsFetch && !isNearViewport) return
    setLoading(true)
    noteStatsService
      .fetchNoteStats(event, pubkey, statsRelaysRef.current, {
        foreground: foregroundStats,
        relayAllowlist: seenOnAllowlistRef.current?.length ? seenOnAllowlistRef.current : null
      })
      .finally(() => setLoading(false))
    // Intentionally omit `event` object: parent feeds often pass new references each render;
    // id/sig/kind/created_at identify the note for refetch boundaries.
    // `statsRelayFetchTier` (not full sorted relay key) avoids a REQ storm when favorites/current relays hydrate.
    // `seenOnAllowlistKey` (not the array ref) avoids refetch loops when parents pass a new [] each render.
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
    currentRelaysKey,
    seenOnAllowlistKey
  ])

  const interactionButtons = (
    <>
      <ReplyButtonWithStats event={event} noteStats={noteStats} />
      {!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot && (
        <RepostButtonWithStats event={event} noteStats={noteStats} />
      )}
      <LikeButtonWithStats
        event={event}
        noteStats={noteStats}
        isReplyToDiscussion={isReplyToDiscussion}
        useIconOnlyLikeTrigger={useIconOnlyLikeTrigger}
      />
      {!isRssArticleRoot && (
        <ZapButtonWithStats event={event} noteStats={noteStats} />
      )}
    </>
  )

  const utilityButtons = !isRssArticleRoot ? (
    <>
      <NotificationThreadWatchButtons event={event} />
      <BookmarkButton event={event} />
    </>
  ) : null

  return (
    <div
      ref={containerRef}
      className={cn('select-none min-w-0', className)}
      data-note-stats
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-2 [&_svg]:size-4 max-sm:[&_button]:pr-2',
          loading ? 'animate-pulse' : '',
          classNames?.buttonBar
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center">{interactionButtons}</div>
        <div className="flex shrink-0 flex-wrap items-center">
          {utilityButtons}
          <SeenOnButton event={event} allowedRelays={seenOnAllowlist} />
        </div>
      </div>
    </div>
  )
}
