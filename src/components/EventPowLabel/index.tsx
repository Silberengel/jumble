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
        'inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-500/20',
        'bg-amber-500/[0.08] px-1 py-px text-[10px] font-medium leading-none text-amber-800/75',
        'dark:border-amber-400/15 dark:bg-amber-500/10 dark:text-amber-200/65',
        className
      )}
      title={t('Proof of Work')}
    >
      <Pickaxe className="size-2.5 shrink-0 opacity-60" strokeWidth={2} aria-hidden />
      {t('POW {{difficulty}}', { difficulty })}
    </span>
  )
}
