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
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LikeButtonWithStats } from './LikeButton'
import { ReplyButtonWithStats } from './ReplyButton'
import { RepostButtonWithStats } from './RepostButton'
import { ZapButtonWithStats } from './ZapButton'

/** One slot in the note action bar; left-aligned with gap spacing (not equal-width columns). */
function NoteStatsBarItem({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden [&>*]:min-w-0 [&>*]:max-w-full',
        className
      )}
    >
      {children}
    </div>
  )
}

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
  const seenOnAllowlistKey = seenOnAllowlist?.length
    ? [...seenOnAllowlist]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|')
    : ''
  /** Home favorites feed: stats are scoped to the feed allowlist — ignore hint/current-relay churn. */
  const usesFeedStatsAllowlist = Boolean(seenOnAllowlistKey)
  const statsRelayFetchTier = isRssArticleRoot
    ? relayMergeTier
    : usesFeedStatsAllowlist
      ? 0
      : hintRelays.length > 0
        ? 1
        : 0
  const statsFetchRelayScopeKey = usesFeedStatsAllowlist
    ? seenOnAllowlistKey
    : `${statsRelayFetchTier}|${currentRelaysKey}`
  const statsRelaysRef = useRef(statsRelays)
  statsRelaysRef.current = statsRelays
  const seenOnAllowlistRef = useRef(seenOnAllowlist)
  seenOnAllowlistRef.current = seenOnAllowlist
  const shouldDeferStatsFetch =
    deferFetchUntilNearViewport ?? (fetchIfNotExisting && !foregroundStats)
  const containerRef = useRef<HTMLDivElement>(null)
  const isNearViewport = useNearViewport(containerRef, { enabled: shouldDeferStatsFetch })

  useEffect(() => {
    if (!fetchIfNotExisting) return
    if (shouldDeferStatsFetch && !isNearViewport) return
    noteStatsService.prefetchArchivesInteractions(event.id)
    /** Feed cards: Archives aggregate counts are enough for badges — skip relay REQ storms. */
    if (!foregroundStats) return
    setLoading(true)
    noteStatsService
      .fetchNoteStats(event, pubkey, statsRelaysRef.current, {
        foreground: foregroundStats,
        relayAllowlist: seenOnAllowlistRef.current?.length ? seenOnAllowlistRef.current : null
      })
      .finally(() => setLoading(false))
    // Intentionally omit `event` object: parent feeds often pass new references each render;
    // id/sig/kind/created_at identify the note for refetch boundaries.
    // `statsFetchRelayScopeKey` bundles tier + current relays, or feed allowlist only on home favorites.
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
    statsFetchRelayScopeKey
  ])

  /** Kind 11 / 1111 under a discussion: up+down votes need more width than a single like button. */
  const isDiscussionBar = isDiscussion || isReplyToDiscussion
  const voteBarItem = isDiscussionBar ? 'min-w-[6.75rem] sm:min-w-[7.25rem]' : undefined

  const barItems: ReactNode[] = [
    <NoteStatsBarItem key="reply">
      <ReplyButtonWithStats event={event} noteStats={noteStats} />
    </NoteStatsBarItem>
  ]

  if (!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot) {
    barItems.push(
      <NoteStatsBarItem key="repost">
        <RepostButtonWithStats event={event} noteStats={noteStats} />
      </NoteStatsBarItem>
    )
  }

  barItems.push(
    <NoteStatsBarItem key="like" className={voteBarItem}>
      <LikeButtonWithStats
        event={event}
        noteStats={noteStats}
        isReplyToDiscussion={isReplyToDiscussion}
        useIconOnlyLikeTrigger={useIconOnlyLikeTrigger}
      />
    </NoteStatsBarItem>
  )

  if (!isRssArticleRoot) {
    barItems.push(
      <NoteStatsBarItem key="tip">
        <ZapButtonWithStats event={event} noteStats={noteStats} />
      </NoteStatsBarItem>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('select-none min-w-0', className)}
      data-note-stats
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'flex w-full min-w-0 flex-wrap items-center justify-start gap-x-6 gap-y-2 sm:gap-x-5',
          '[&_svg]:size-5 [&_button]:min-h-11 [&_button]:max-w-full [&_button]:px-3 [&_button]:touch-manipulation sm:[&_button]:min-h-10 sm:[&_button]:px-2',
          loading ? 'animate-pulse' : '',
          classNames?.buttonBar
        )}
      >
        {barItems}
      </div>
    </div>
  )
}
