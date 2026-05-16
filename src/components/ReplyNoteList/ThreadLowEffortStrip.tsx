import { ExtendedKind } from '@/constants'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
  isLowEffortCollapsedReactionEmoji,
  isNegativeLowEffortReactionEmoji,
  isPositiveLowEffortReactionEmoji
} from '@/lib/like-reaction-emojis'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { cn } from '@/lib/utils'
import { useUserTrust } from '@/contexts/user-trust-context'
import { useNostr } from '@/providers/NostrProvider'
import noteStatsService from '@/services/note-stats.service'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '../UserAvatar'

const MAX_AVATARS = 20

type LowEffortRow = { id: string; pubkey: string; created_at: number }

function dedupeByPubkeyNewestFirst(rows: LowEffortRow[]): LowEffortRow[] {
  const byPubkey = new Map<string, LowEffortRow>()
  for (const row of rows) {
    const prev = byPubkey.get(row.pubkey)
    if (!prev || row.created_at > prev.created_at) byPubkey.set(row.pubkey, row)
  }
  return [...byPubkey.values()].sort((a, b) => b.created_at - a.created_at)
}

function filterTrustedRows(
  rows: LowEffortRow[],
  hideUntrusted: boolean,
  isTrustLoaded: boolean,
  isUserTrusted: (pk: string) => boolean
): LowEffortRow[] {
  if (!hideUntrusted || !isTrustLoaded) return rows
  return rows.filter((r) => isUserTrusted(r.pubkey))
}

function CompactAvatarRow({
  items,
  ariaLabel
}: {
  items: LowEffortRow[]
  ariaLabel: string
}) {
  if (items.length === 0) return null
  const visible = items.slice(0, MAX_AVATARS)
  const overflow = items.length - visible.length

  return (
    <div className="flex flex-wrap items-center gap-0.5" role="list" aria-label={ariaLabel}>
      {visible.map((item) => (
        <div key={item.id} role="listitem" className="shrink-0">
          <UserAvatar userId={item.pubkey} size="xSmall" className="ring-1 ring-background" />
        </div>
      ))}
      {overflow > 0 ? (
        <span className="text-[10px] font-medium text-muted-foreground/80 px-0.5">+{overflow}</span>
      ) : null}
    </div>
  )
}

function ReactionRow({
  label,
  glyph,
  items,
  ariaLabel
}: {
  label: string
  glyph?: string
  items: LowEffortRow[]
  ariaLabel: string
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="text-muted-foreground text-sm shrink-0 mr-0.5">{label}</span>
      {glyph ? (
        <span className="text-sm leading-none shrink-0" aria-hidden>
          {glyph}
        </span>
      ) : null}
      <CompactAvatarRow items={items} ariaLabel={ariaLabel} />
    </div>
  )
}

/**
 * Subtle booster + collapsed-reaction rows at the bottom of a note thread (secondary page).
 * Feed cards keep the prominent {@link NoteBoostBadges} strip.
 */
export default function ThreadLowEffortStrip({
  event,
  className
}: {
  /** Open note (for quiet-mode / discussion checks); boost/like stats use this note’s id. */
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const noteStats = useNoteStatsById(event.id)
  const { relays: statsRelays, currentRelaysKey } = useNoteStatsRelayHints()
  const { hideUntrustedInteractions, isUserTrusted, isTrustLoaded } = useUserTrust()

  useEffect(() => {
    if (!event.id || shouldHideInteractions(event)) return
    void noteStatsService.fetchNoteStats(event, pubkey, statsRelays, { foreground: true })
  }, [event, pubkey, statsRelays, currentRelaysKey])

  const boosters = useMemo(() => {
    const rows = [...(noteStats?.reposts ?? [])]
    return filterTrustedRows(
      dedupeByPubkeyNewestFirst(rows),
      hideUntrustedInteractions,
      isTrustLoaded,
      isUserTrusted
    )
  }, [noteStats?.reposts, hideUntrustedInteractions, isTrustLoaded, isUserTrusted])

  const { likedBy, dislikedBy } = useMemo(() => {
    if (event.kind === ExtendedKind.DISCUSSION) {
      return { likedBy: [], dislikedBy: [] }
    }
    const positive: LowEffortRow[] = []
    const negative: LowEffortRow[] = []
    for (const like of noteStats?.likes ?? []) {
      if (
        !isLowEffortCollapsedReactionEmoji(like.emoji) ||
        isDiscussionUpvoteEmoji(like.emoji) ||
        isDiscussionDownvoteEmoji(like.emoji)
      ) {
        continue
      }
      const row = { id: like.id, pubkey: like.pubkey, created_at: like.created_at }
      if (isNegativeLowEffortReactionEmoji(like.emoji)) {
        negative.push(row)
      } else if (isPositiveLowEffortReactionEmoji(like.emoji)) {
        positive.push(row)
      }
    }
    const trust = (rows: LowEffortRow[]) =>
      filterTrustedRows(rows, hideUntrustedInteractions, isTrustLoaded, isUserTrusted)
    return {
      likedBy: trust(dedupeByPubkeyNewestFirst(positive)),
      dislikedBy: trust(dedupeByPubkeyNewestFirst(negative))
    }
  }, [event.kind, noteStats?.likes, hideUntrustedInteractions, isTrustLoaded, isUserTrusted])

  const hasReactions = likedBy.length > 0 || dislikedBy.length > 0
  if (shouldHideInteractions(event) || (boosters.length === 0 && !hasReactions)) {
    return null
  }

  return (
    <div
      className={cn(
        'mx-2 sm:mx-4 border-t border-border/40 pt-2 pb-1 space-y-1.5 opacity-80',
        className
      )}
    >
      {boosters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="text-muted-foreground text-sm shrink-0 mr-0.5">{t('Boosted by:')}</span>
          <CompactAvatarRow items={boosters} ariaLabel={t('Boosts')} />
        </div>
      ) : null}
      <ReactionRow
        label={t('Liked by:')}
        glyph={DEFAULT_LIKE_REACTION_DISPLAY_EMOJI}
        items={likedBy}
        ariaLabel={t('Likes')}
      />
      <ReactionRow label={t('Disliked by:')} items={dislikedBy} ariaLabel={t('Dislikes')} />
    </div>
  )
}
