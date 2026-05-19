import { useSmartNoteNavigation } from '@/PageManager'
import ClientTag from '@/components/ClientTag'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import Nip05 from '@/components/Nip05'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import { parseNip56Report } from '@/lib/nip56-report-display'
import { toNote, toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Event } from 'nostr-tools'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function ReportTargetLinks({
  parsed,
  className
}: {
  parsed: NonNullable<ReturnType<typeof parseNip56Report>>
  className?: string
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()

  const hasTargets =
    parsed.reportedPubkeys.length > 0 ||
    parsed.reportedEventIds.length > 0 ||
    parsed.reportedAddresses.length > 0

  if (!hasTargets) return null

  return (
    <ul className={cn('mt-2 space-y-1 text-sm', className)}>
      {parsed.reportedPubkeys.map((pk) => (
        <li key={`p-${pk}`}>
          <a
            href={toProfile(pk)}
            className="font-medium text-amber-950 underline-offset-2 hover:underline dark:text-amber-50"
            onClick={(e) => e.stopPropagation()}
          >
            {t('Report target profile')}
          </a>
        </li>
      ))}
      {parsed.reportedEventIds.map((id) => (
        <li key={`e-${id}`}>
          <button
            type="button"
            className="font-medium text-amber-950 underline-offset-2 hover:underline dark:text-amber-50"
            onClick={(e) => {
              e.stopPropagation()
              void client.fetchEvent(id).then((ev) => {
                if (ev) navigateToNote(toNote(ev), ev)
                else navigateToNote(toNote(id))
              })
            }}
          >
            {t('Report target note')}
          </button>
        </li>
      ))}
      {parsed.reportedAddresses.map((a) => (
        <li key={`a-${a}`} className="break-all font-mono text-xs text-amber-950/85 dark:text-amber-50/85">
          {a}
        </li>
      ))}
    </ul>
  )
}

const ReportCard = memo(function ReportCard({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const parsed = useMemo(() => parseNip56Report(event), [event])

  if (!parsed) return null

  return (
    <article
      className={cn(
        'clickable rounded-lg border px-3 py-3',
        'border-amber-600/45 bg-amber-500/[0.07] hover:border-amber-600/60 hover:bg-amber-500/[0.11]',
        'dark:border-amber-500/40 dark:bg-amber-500/[0.08] dark:hover:border-amber-400/50 dark:hover:bg-amber-500/[0.12]',
        className
      )}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (
          target.closest('button') ||
          target.closest('[role="button"]') ||
          target.closest('a')
        ) {
          return
        }
        client.addEventToCache(event)
        navigateToNote(toNote(event), event)
      }}
    >
      <div className="flex items-start gap-2">
        <SimpleUserAvatar
          userId={event.pubkey}
          size="medium"
          className="ring-1 ring-amber-600/35 dark:ring-amber-400/35"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <SimpleUsername
                userId={event.pubkey}
                className="truncate text-sm font-semibold text-amber-950 dark:text-amber-50"
                skeletonClassName="h-3"
              />
              <ClientTag event={event} />
            </div>
            <div className="flex shrink-0 items-center gap-1 text-xs text-amber-900/75 dark:text-amber-100/70">
              <Nip05 pubkey={event.pubkey} append="·" />
              <FormattedTimestamp timestamp={event.created_at} short />
            </div>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-950/90 dark:text-amber-100/90">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            {t('Report card heading')}
          </p>
          {parsed.reportType && parsed.reportType !== parsed.reason ? (
            <p className="mt-1.5 text-xs font-medium text-amber-950/80 dark:text-amber-50/80">
              <span className="text-amber-900/70 dark:text-amber-100/65">{t('Report type label')}: </span>
              {parsed.reportType}
            </p>
          ) : null}
          {parsed.reason ? (
            <p className="mt-1.5 text-sm leading-snug text-amber-950/90 dark:text-amber-50/95">{parsed.reason}</p>
          ) : null}
          <ReportTargetLinks parsed={parsed} />
        </div>
        <ChevronRight
          className="mt-1 size-4 shrink-0 text-amber-700/60 dark:text-amber-300/60"
          aria-hidden
        />
      </div>
    </article>
  )
})

ReportCard.displayName = 'ReportCard'

export default ReportCard
