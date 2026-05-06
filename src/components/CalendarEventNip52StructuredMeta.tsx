import { getNip52CalendarEventTagExtras, type CalendarEventMeta } from '@/lib/calendar-event'
import { useSmartNoteNavigation } from '@/PageManager'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Calendar, ExternalLink, Link2, MapPin } from 'lucide-react'

type Placement = 'beforeDescription' | 'afterDescription'

export function CalendarEventNip52StructuredMeta({
  placement,
  event,
  meta,
  isDateBased
}: {
  placement: Placement
  event: Event
  meta: CalendarEventMeta
  isDateBased: boolean
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const extras = useMemo(() => getNip52CalendarEventTagExtras(event), [event])

  if (placement === 'beforeDescription') {
    const summaryTrim = meta.summary?.trim() ?? ''
    const hasLocations = meta.locations.length > 0
    const hasGeo = !!meta.geo?.trim()
    if (!hasLocations && !summaryTrim && !hasGeo) return null

    return (
      <div className="min-w-0 space-y-3 border-t border-border/50 pt-3">
        {hasLocations ? (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.locations.length > 1 ? t('calendarNip52Locations') : t('calendarNip52Location')}
            </div>
            {meta.locations.length === 1 ? (
              <p className="flex gap-2 text-sm leading-snug text-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">{meta.locations[0]}</span>
              </p>
            ) : (
              <ul className="min-w-0 space-y-2">
                {meta.locations.map((loc, i) => (
                  <li key={`${i}-${loc.slice(0, 24)}`} className="flex gap-2 text-sm leading-snug text-foreground">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">{loc}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {summaryTrim ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('calendarNip52Summary')}
            </div>
            <blockquote className="border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-muted-foreground">
              {summaryTrim}
            </blockquote>
          </div>
        ) : null}
        {hasGeo ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('calendarNip52Geohash')}
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-mono text-foreground">
              <span className="break-all">{meta.geo.trim()}</span>
              <Button variant="outline" size="sm" className="h-8 shrink-0" asChild>
                <a
                  href={`https://geohash.org/${encodeURIComponent(meta.geo.trim())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-3.5" />
                  {t('calendarNip52ViewGeohash')}
                </a>
              </Button>
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  const hasDayD = !isDateBased && extras.dayGranularities.length > 0
  const hasInclusions = extras.calendarInclusions.length > 0
  const hasR = extras.rTags.length > 0
  const hasD = !!meta.d?.trim()
  const hasUnknown = extras.unknownTags.length > 0

  if (!hasDayD && !hasInclusions && !hasR && !hasD && !hasUnknown) return null

  return (
    <div className="min-w-0 space-y-4 border-t border-border/50 pt-3">
      {hasDayD ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52DayIndices')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {extras.dayGranularities.map((d) => (
              <span
                key={d}
                className="inline-flex items-center rounded-md bg-muted/80 px-2 py-1 font-mono text-xs font-medium text-foreground ring-1 ring-border/50"
              >
                D={d}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {hasInclusions ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52CalendarInclusion')}
          </div>
          <ul className="min-w-0 space-y-1.5">
            {extras.calendarInclusions.map((row) => (
              <li key={row.coordinate}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-auto min-h-9 w-full max-w-full justify-start gap-2 whitespace-normal px-3 py-2 text-left font-normal"
                  onClick={() => navigateToNote(row.naddr)}
                >
                  <Calendar className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 break-all font-mono text-xs leading-snug">{row.naddr}</span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-muted-foreground">{t('calendarNip52CalendarInclusionHint')}</p>
        </div>
      ) : null}

      {hasR ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52References')}
          </div>
          <ul className="min-w-0 space-y-2">
            {extras.rTags.map((r, idx) => (
              <li key={`${r.value}-${idx}`} className="min-w-0">
                {r.isHttpUrl ? (
                  <Button variant="outline" size="sm" className="h-auto min-h-9 w-full max-w-full justify-start gap-2 px-3 py-2" asChild>
                    <a href={r.value} target="_blank" rel="noopener noreferrer">
                      <Link2 className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 break-all text-left text-xs font-medium">{r.value}</span>
                    </a>
                  </Button>
                ) : (
                  <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 break-all font-mono text-foreground">{r.value}</span>
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasD ? (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52Identifier')}
          </div>
          <p className="break-all font-mono text-xs text-foreground">{meta.d.trim()}</p>
        </div>
      ) : null}

      {hasUnknown ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52OtherTags')}
          </div>
          <dl className="min-w-0 space-y-2 rounded-lg border border-border/50 bg-muted/15 p-3">
            {extras.unknownTags.map((tag, idx) => (
              <div key={`${tag[0]}-${idx}`} className="grid gap-1 sm:grid-cols-[minmax(0,6rem)_1fr] sm:gap-2">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tag[0] || '—'}
                </dt>
                <dd className="min-w-0 break-all text-xs text-foreground">
                  {tag.length > 1 ? tag.slice(1).join(' · ') : '—'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  )
}
