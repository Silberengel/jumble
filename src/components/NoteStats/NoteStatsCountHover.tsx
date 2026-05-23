import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import Emoji from '@/components/Emoji'
import Username from '@/components/Username'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY,
  isDiscussionDownvoteEmoji,
  isDiscussionUpvoteEmoji
} from '@/lib/discussion-votes'
import {
  aggregateZapsByPubkey,
  dedupeBoostersByPubkey,
  emojiStatsKey,
  filterStatsInteractors,
  groupReactionsByEmoji,
  MAX_NOTE_STATS_INTERACTORS_SHOWN
} from '@/lib/note-stats-interactors'
import { cn } from '@/lib/utils'
import type { TNoteStats } from '@/services/note-stats.service'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { useUserTrust } from '@/contexts/user-trust-context'
import { TEmoji } from '@/types'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

function formatZapLineAmount(amount: number) {
  if (amount < 1000) return String(amount)
  if (amount < 1_000_000) return `${Math.round(amount / 100) / 10}k`
  return `${Math.round(amount / 100_000) / 10}M`
}

function InteractorList({
  pubkeys,
  title,
  suffixForPubkey
}: {
  pubkeys: string[]
  title: ReactNode
  suffixForPubkey?: (pubkey: string) => ReactNode
}) {
  const { t } = useTranslation()
  const feedProfiles = useNoteFeedProfileContext()
  const visible = pubkeys.slice(0, MAX_NOTE_STATS_INTERACTORS_SHOWN)
  const overflow = pubkeys.length - visible.length

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="max-h-52 space-y-1 overflow-y-auto overscroll-y-contain pr-0.5">
        {visible.map((pk) => (
          <li
            key={pk}
            className="flex min-w-0 items-center gap-1.5 text-sm leading-snug text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Username
              userId={pk}
              showAt
              className="min-w-0 truncate font-medium"
              prefetchedProfile={feedProfiles?.profiles.get(pk.toLowerCase())}
            />
            {suffixForPubkey?.(pk)}
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('n more interactors', { count: overflow })}
        </p>
      ) : null}
    </div>
  )
}

function ReactionGroupsList({
  groups,
  title
}: {
  groups: { emoji: TEmoji | string; pubkeys: string[] }[]
  title: ReactNode
}) {
  const { t } = useTranslation()
  const feedProfiles = useNoteFeedProfileContext()
  let shownPubkeys = 0

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="max-h-52 space-y-2 overflow-y-auto overscroll-y-contain pr-0.5">
        {groups.map((group) => {
          const remaining = MAX_NOTE_STATS_INTERACTORS_SHOWN - shownPubkeys
          if (remaining <= 0) return null
          const slice = group.pubkeys.slice(0, remaining)
          shownPubkeys += slice.length
          const overflowInGroup = group.pubkeys.length - slice.length
          return (
            <div key={emojiStatsKey(group.emoji)} className="min-w-0">
              <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Emoji emoji={group.emoji} classNames={{ img: 'size-4' }} />
                <span className="tabular-nums">{group.pubkeys.length}</span>
              </div>
              <ul className="space-y-0.5 pl-1">
                {slice.map((pk) => (
                  <li
                    key={pk}
                    className="min-w-0 text-sm leading-snug"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Username
                      userId={pk}
                      showAt
                      className="min-w-0 truncate font-medium"
                      prefetchedProfile={feedProfiles?.profiles.get(pk.toLowerCase())}
                    />
                  </li>
                ))}
              </ul>
              {overflowInGroup > 0 ? (
                <p className="mt-0.5 pl-1 text-xs text-muted-foreground">
                  {t('n more interactors', { count: overflowInGroup })}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function NoteStatsCountHover({
  enabled,
  children,
  content,
  className
}: {
  enabled: boolean
  children: ReactNode
  content: ReactNode
  className?: string
}) {
  if (!enabled) {
    return <>{children}</>
  }

  return (
    <HoverCard openDelay={220} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          className={cn(
            'cursor-help underline decoration-dotted decoration-muted-foreground/45 underline-offset-2',
            className
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        className="z-[100] w-72 p-3"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}

export function BoostCountHover({
  noteStats,
  children
}: {
  noteStats?: Partial<TNoteStats>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const pubkeys = useMemo(() => {
    const filtered = filterStatsInteractors(noteStats?.reposts, hideUntrustedInteractions, isUserTrusted)
    return dedupeBoostersByPubkey(filtered).map((r) => r.pubkey)
  }, [noteStats?.reposts, hideUntrustedInteractions, isUserTrusted])

  return (
    <NoteStatsCountHover
      enabled={pubkeys.length > 0}
      content={<InteractorList pubkeys={pubkeys} title={t('Boosted by:')} />}
    >
      {children}
    </NoteStatsCountHover>
  )
}

export function ReactionCountHover({
  noteStats,
  emojiFilter,
  title: titleProp,
  children
}: {
  noteStats?: Partial<TNoteStats>
  /** When set, only reactions matching this predicate (e.g. upvote / downvote). */
  emojiFilter?: (emoji: TEmoji | string) => boolean
  title?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const { groups, title } = useMemo(() => {
    let likes = filterStatsInteractors(noteStats?.likes, hideUntrustedInteractions, isUserTrusted)
    if (emojiFilter) likes = likes.filter((l) => emojiFilter(l.emoji))
    return {
      groups: groupReactionsByEmoji(likes),
      title: titleProp ?? t('Liked by:')
    }
  }, [noteStats?.likes, hideUntrustedInteractions, isUserTrusted, emojiFilter, titleProp, t])

  const total = groups.reduce((n, g) => n + g.pubkeys.length, 0)

  return (
    <NoteStatsCountHover
      enabled={total > 0}
      content={<ReactionGroupsList groups={groups} title={title} />}
    >
      {children}
    </NoteStatsCountHover>
  )
}

export function DiscussionVoteCountHover({
  noteStats,
  vote,
  children
}: {
  noteStats?: Partial<TNoteStats>
  vote: 'up' | 'down'
  children: ReactNode
}) {
  const { t } = useTranslation()
  const emojiFilter = vote === 'up' ? isDiscussionUpvoteEmoji : isDiscussionDownvoteEmoji

  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const pubkeys = useMemo(() => {
    const likes = filterStatsInteractors(noteStats?.likes, hideUntrustedInteractions, isUserTrusted)
      .filter((l) => emojiFilter(l.emoji))
    const byPk = new Map<string, number>()
    for (const l of likes) {
      const pk = l.pubkey.toLowerCase()
      const prev = byPk.get(pk)
      if (prev == null || l.created_at > prev) byPk.set(pk, l.created_at)
    }
    return [...byPk.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pk]) => pk)
  }, [noteStats?.likes, hideUntrustedInteractions, isUserTrusted, emojiFilter])

  const title = (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden>
        {vote === 'up' ? DISCUSSION_UPVOTE_DISPLAY : DISCUSSION_DOWNVOTE_DISPLAY}
      </span>
      {vote === 'up' ? t('Liked by:') : t('Disliked by:')}
    </span>
  )

  return (
    <NoteStatsCountHover
      enabled={pubkeys.length > 0}
      content={<InteractorList pubkeys={pubkeys} title={title} />}
    >
      {children}
    </NoteStatsCountHover>
  )
}

export function ZapCountHover({
  noteStats,
  children
}: {
  noteStats?: Partial<TNoteStats>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const zappers = useMemo(() => {
    const filtered = filterStatsInteractors(noteStats?.zaps, hideUntrustedInteractions, isUserTrusted)
    return aggregateZapsByPubkey(filtered)
  }, [noteStats?.zaps, hideUntrustedInteractions, isUserTrusted])

  return (
    <NoteStatsCountHover
      enabled={zappers.length > 0}
      content={
        <InteractorList
          pubkeys={zappers.map((z) => z.pubkey)}
          title={t('Zapped by:')}
          suffixForPubkey={(pk) => {
            const row = zappers.find((z) => z.pubkey.toLowerCase() === pk.toLowerCase())
            if (!row?.amount) return null
            return (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatZapLineAmount(row.amount)} {t('sats')}
              </span>
            )
          }}
        />
      }
    >
      {children}
    </NoteStatsCountHover>
  )
}
