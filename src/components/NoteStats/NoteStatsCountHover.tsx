import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import Emoji from '@/components/Emoji'
import { useLongPressAction } from '@/hooks/use-long-press-action'
import { useNoteStatsDetailOpenMode } from '@/hooks/use-note-stats-detail-open-mode'
import Username from '@/components/Username'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY,
  isDiscussionDownvoteEmoji,
  isDiscussionUpvoteEmoji
} from '@/lib/discussion-votes'
import {
  aggregateMoneroTipsByPubkey,
  aggregateSatoshiPaymentsByPubkey,
  dedupeBoostersByPubkey,
  emojiStatsKey,
  groupReactionsByEmoji,
  MAX_NOTE_STATS_INTERACTORS_SHOWN
} from '@/lib/note-stats-interactors'
import { formatPiconeroLineAmount } from '@/lib/monero-tip'
import { cn } from '@/lib/utils'
import type { TNoteStats } from '@/services/note-stats.service'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { TEmoji } from '@/types'
import { useMemo, useState, type PointerEvent, type ReactNode } from 'react'
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

const statsCountTriggerClass =
  'underline decoration-dotted decoration-muted-foreground/45 underline-offset-2'

function stopTriggerBubble(e: { stopPropagation: () => void }) {
  e.stopPropagation()
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
  const { t } = useTranslation()
  const openMode = useNoteStatsDetailOpenMode()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const longPress = useLongPressAction(() => setPopoverOpen(true), {
    enabled: enabled && openMode === 'longPress'
  })

  if (!enabled) {
    return <>{children}</>
  }

  const trigger = (
    <span
      className={cn(
        statsCountTriggerClass,
        openMode === 'hover' ? 'cursor-help' : 'cursor-default touch-manipulation',
        className
      )}
      title={openMode === 'longPress' ? t('noteStats.longPressForDetails') : undefined}
      onClick={(e) => {
        stopTriggerBubble(e)
        if (longPress.consumeIfLongPress()) return
      }}
      onMouseDown={stopTriggerBubble}
      onTouchStart={stopTriggerBubble}
      {...(openMode === 'longPress'
        ? {
            onPointerDown: (e: PointerEvent<HTMLSpanElement>) => {
              stopTriggerBubble(e)
              longPress.onPointerDown()
            },
            onPointerUp: (e: PointerEvent<HTMLSpanElement>) => {
              stopTriggerBubble(e)
              longPress.onPointerUp()
            },
            onPointerLeave: (e: PointerEvent<HTMLSpanElement>) => {
              stopTriggerBubble(e)
              longPress.onPointerLeave()
            },
            onPointerCancel: (e: PointerEvent<HTMLSpanElement>) => {
              stopTriggerBubble(e)
              longPress.onPointerCancel()
            }
          }
        : {})}
    >
      {children}
    </span>
  )

  const panel = (
    <div
      className="min-w-0"
      onPointerDown={stopTriggerBubble}
      onClick={stopTriggerBubble}
    >
      {content}
    </div>
  )

  if (openMode === 'longPress') {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent side="top" align="center" className="z-[100] w-[min(18rem,calc(100vw-1.5rem))] max-w-none p-3">
          {panel}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <HoverCard openDelay={220} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="z-[100] w-[min(18rem,calc(100vw-1.5rem))] max-w-none p-3">
        {panel}
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
  const pubkeys = useMemo(() => {
    const filtered = noteStats?.reposts ?? []
    return dedupeBoostersByPubkey(filtered).map((r) => r.pubkey)
  }, [noteStats?.reposts])

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
  const { groups, title } = useMemo(() => {
    let likes = noteStats?.likes ?? []
    if (emojiFilter) likes = likes.filter((l) => emojiFilter(l.emoji))
    return {
      groups: groupReactionsByEmoji(likes),
      title: titleProp ?? t('Liked by:')
    }
  }, [noteStats?.likes, emojiFilter, titleProp, t])

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

  const pubkeys = useMemo(() => {
    const likes = (noteStats?.likes ?? []).filter((l) => emojiFilter(l.emoji))
    const byPk = new Map<string, number>()
    for (const l of likes) {
      const pk = l.pubkey.toLowerCase()
      const prev = byPk.get(pk)
      if (prev == null || l.created_at > prev) byPk.set(pk, l.created_at)
    }
    return [...byPk.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pk]) => pk)
  }, [noteStats?.likes, emojiFilter])

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
  const zappers = useMemo(() => {
    return aggregateSatoshiPaymentsByPubkey(
      noteStats?.zaps ?? [],
      noteStats?.paymentNotifications ?? []
    )
  }, [noteStats?.zaps, noteStats?.paymentNotifications])
  const moneroTippers = useMemo(() => {
    const filtered = noteStats?.moneroTips ?? []
    return aggregateMoneroTipsByPubkey(filtered)
  }, [noteStats?.moneroTips])

  const formatSatoshiLabel = (amount: number) => {
    const unit = amount === 1 ? t('satoshi') : t('satoshis')
    return `${formatZapLineAmount(amount)} ${unit}`
  }

  const formatPiconeroLabel = (amountPiconero: number) => {
    const unit = amountPiconero === 1 ? t('piconero') : t('piconeros')
    return `${formatPiconeroLineAmount(amountPiconero)} ${unit}`
  }

  return (
    <NoteStatsCountHover
      enabled={zappers.length > 0 || moneroTippers.length > 0}
      content={
        <div className="space-y-3">
          {zappers.length > 0 ? (
            <InteractorList
              pubkeys={zappers.map((z) => z.pubkey)}
              title={t('Lightning zapped by:')}
              suffixForPubkey={(pk) => {
                const row = zappers.find((z) => z.pubkey.toLowerCase() === pk.toLowerCase())
                if (!row?.amount) return null
                return (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatSatoshiLabel(row.amount)}
                  </span>
                )
              }}
            />
          ) : null}
          {moneroTippers.length > 0 ? (
            <InteractorList
              pubkeys={moneroTippers.map((z) => z.pubkey)}
              title={t('Monero tipped by:')}
              suffixForPubkey={(pk) => {
                const row = moneroTippers.find((z) => z.pubkey.toLowerCase() === pk.toLowerCase())
                if (!row?.amountPiconero) return null
                return (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatPiconeroLabel(row.amountPiconero)}
                  </span>
                )
              }}
            />
          ) : null}
        </div>
      }
    >
      {children}
    </NoteStatsCountHover>
  )
}
