import { ExtendedKind } from '@/constants'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '../UserAvatar'

const MAX_VISIBLE = 28

/**
 * Avatar strip of users who boosted (kind 6 / 16) — feed cards only (attention on the timeline).
 * Thread view uses {@link ThreadLowEffortStrip} at the bottom of replies instead.
 */
export default function NoteBoostBadges({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const noteStats = useNoteStatsById(event.id)

  const boosters = useMemo(() => {
    if (event.kind === ExtendedKind.DISCUSSION) return []
    return [...(noteStats?.reposts ?? [])].sort((a, b) => b.created_at - a.created_at)
  }, [noteStats, event.kind])

  if (shouldHideInteractions(event) || boosters.length === 0) {
    return null
  }

  const visible = boosters.slice(0, MAX_VISIBLE)
  const overflow = boosters.length - visible.length

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-1 gap-y-1', className)}
      role="list"
      aria-label={t('Boosts')}
    >
      <span className="text-muted-foreground text-sm shrink-0 mr-1">
        {t('Boosted by:')}
      </span>
      {visible.map((r) => (
        <div key={r.id} role="listitem">
          <UserAvatar userId={r.pubkey} size="small" className="ring-2 ring-background" />
        </div>
      ))}
      {overflow > 0 ? (
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-2 ring-background"
          title={t('n more boosts', { count: overflow })}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
