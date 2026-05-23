import { getEventNoncePowDifficulty } from '@/lib/event-pow'
import { cn } from '@/lib/utils'
import { Pickaxe } from 'lucide-react'
import type { Event, NostrEvent } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function EventPowLabel({
  event,
  className
}: {
  event: Event | NostrEvent
  className?: string
}) {
  const { t } = useTranslation()
  const difficulty = useMemo(() => getEventNoncePowDifficulty(event), [event])

  if (difficulty == null) return null

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border-2 border-amber-500/90',
        'bg-gradient-to-r from-amber-400/40 to-yellow-300/30 px-2 py-0.5',
        'text-xs font-bold uppercase tracking-wide text-amber-950 shadow-sm',
        'ring-2 ring-amber-400/35 dark:border-amber-400/80 dark:from-amber-500/30 dark:to-yellow-500/20',
        'dark:text-amber-50 dark:ring-amber-300/25',
        className
      )}
      title={t('Proof of Work')}
    >
      <Pickaxe className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {t('POW: difficulty {{difficulty}}', { difficulty })}
    </span>
  )
}
