import { ExtendedKind } from '@/constants'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
  isDefaultPlusLikeReactionEmoji
} from '@/lib/like-reaction-emojis'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { cn } from '@/lib/utils'
import { useUserTrust } from '@/contexts/user-trust-context'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
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

/**
 * Subtle booster + default-like rows at the bottom of a note thread (secondary page).
 * Feed cards keep the prominent {@link NoteBoostBadges} strip.
 */
export default function ThreadLowEffortStrip({
  event,
  statsNoteId,
  className
}: {
  /** Open note (for quiet-mode / discussion checks). */
  event: Event
  /** Hex id of the thread root whose boosts/likes to show (usually the OP). */
  statsNoteId: string
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const noteStats = useNoteStatsById(statsNoteId)
  const { relays: statsRelays, currentRelaysKey } = useNoteStatsRelayHints()
  const { hideUntrustedInteractions, isUserTrusted, isTrustLoaded } = useUserTrust()

  const statsTargetEvent = useMemo(() => {
    const cached = client.peekSessionCachedEvent(statsNoteId)
    if (cached) return cached
    if (event.id === statsNoteId) return event
    return undefined
  }, [statsNoteId, event])

  useEffect(() => {
    if (!statsNoteId || shouldHideInteractions(event)) return
    const target = statsTargetEvent ?? client.peekSessionCachedEvent(statsNoteId)
    if (!target) return
    void noteStatsService.fetchNoteStats(target, pubkey, statsRelays, { foreground: true })
  }, [statsNoteId, statsTargetEvent, event, pubkey, statsRelays, currentRelaysKey])

  const boosters = useMemo(() => {
    let rows = [...(noteStats?.reposts ?? [])]
    if (hideUntrustedInteractions && isTrustLoaded) {
      rows = rows.filter((r) => isUserTrusted(r.pubkey))
    }
    return dedupeByPubkeyNewestFirst(rows)
  }, [noteStats?.reposts, hideUntrustedInteractions, isTrustLoaded, isUserTrusted])

  const plusLikers = useMemo(() => {
    if (event.kind === ExtendedKind.DISCUSSION) return []
    let rows =
      noteStats?.likes?.filter(
        (like) =>
          isDefaultPlusLikeReactionEmoji(like.emoji) &&
          !isDiscussionUpvoteEmoji(like.emoji) &&
          !isDiscussionDownvoteEmoji(like.emoji)
      ) ?? []
    if (hideUntrustedInteractions && isTrustLoaded) {
      rows = rows.filter((like) => isUserTrusted(like.pubkey))
    }
    return dedupeByPubkeyNewestFirst(rows)
  }, [event.kind, noteStats?.likes, hideUntrustedInteractions, isTrustLoaded, isUserTrusted])

  if (shouldHideInteractions(event) || (boosters.length === 0 && plusLikers.length === 0)) {
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
      {plusLikers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="text-muted-foreground text-sm shrink-0 mr-0.5">{t('Liked by:')}</span>
          <span className="text-sm leading-none shrink-0" aria-hidden>
            {DEFAULT_LIKE_REACTION_DISPLAY_EMOJI}
          </span>
          <CompactAvatarRow items={plusLikers} ariaLabel={t('Likes')} />
        </div>
      ) : null}
    </div>
  )
}
