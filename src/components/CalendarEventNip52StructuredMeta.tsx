import {
  getNip52CalendarEventTagExtras,
  summarizeNip52DayGranularityTags,
  type CalendarEventMeta
} from '@/lib/calendar-event'
import { useSmartNoteNavigation } from '@/PageManager'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, ExternalLink, Link2, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

type Placement = 'beforeDescription' | 'afterDescription'

/** [Geohash Explorer](https://geohash.softeng.co/) style URL for a geohash string. */
function nip52GeohashSoftengUrl(geohash: string): string {
  const h = geohash.trim()
  return `https://geohash.softeng.co/${encodeURIComponent(h)}`
}

/** Google Maps “place” style URL from a free-text address or place name. */
function googleMapsPlaceUrl(placeQuery: string): string {
  const q = placeQuery.trim()
  if (!q) return '#'
  return `https://www.google.com/maps/place/${encodeURIComponent(q).replace(/%20/g, '+')}`
}

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
  const dayGranularitySummary = useMemo(
    () => summarizeNip52DayGranularityTags(extras.dayGranularities),
    [extras.dayGranularities]
  )

  if (placement === 'beforeDescription') {
    const summaryTrim = meta.summary?.trim() ?? ''
    const hasLocations = meta.locations.length > 0
    const hasGeo = !!meta.geo?.trim()
    if (!hasLocations && !summaryTrim && !hasGeo) return null

    const linkClass =
      'inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:text-foreground hover:underline transition-colors'

    return (
      <div className="min-w-0 space-y-2.5 border-t border-border/50 pt-2">
        {hasLocations ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.locations.length > 1 ? t('calendarNip52Locations') : t('calendarNip52Location')}
            </div>
            {meta.locations.length === 1 ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm leading-snug text-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">{meta.locations[0]}</span>
                <a
                  href={googleMapsPlaceUrl(meta.locations[0])}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  <ExternalLink className="size-3 shrink-0 opacity-80" aria-hidden />
                  {t('calendarNip52GoogleMaps')}
                </a>
              </div>
            ) : (
              <ul className="min-w-0 space-y-2">
                {meta.locations.map((loc, i) => (
                  <li key={`${i}-${loc.slice(0, 24)}`}>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm leading-snug text-foreground">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">{loc}</span>
                      <a href={googleMapsPlaceUrl(loc)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        <ExternalLink className="size-3 shrink-0 opacity-80" aria-hidden />
                        {t('calendarNip52GoogleMaps')}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {summaryTrim ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('calendarNip52Summary')}
            </div>
            <blockquote className="border-l-2 border-primary/40 pl-2.5 text-sm leading-snug text-muted-foreground">
              {summaryTrim}
            </blockquote>
          </div>
        ) : null}
        {hasGeo ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('calendarNip52Geohash')}
            </div>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="break-all font-mono text-xs text-foreground">{meta.geo.trim()}</span>
              <a
                href={nip52GeohashSoftengUrl(meta.geo)}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                <ExternalLink className="size-3 shrink-0 opacity-80" aria-hidden />
                {t('calendarNip52ViewGeohash')}
              </a>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const hasDayD = !isDateBased && dayGranularitySummary.length > 0
  const hasInclusions = extras.calendarInclusions.length > 0
  const hasR = extras.rTags.length > 0
  const hasUnknown = extras.unknownTags.length > 0

  if (!hasDayD && !hasInclusions && !hasR && !hasUnknown) return null

  return (
    <div className="min-w-0 space-y-2.5 border-t border-border/50 pt-2">
      {hasDayD ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52DayIndices')}
          </div>
          <p className="text-sm font-medium leading-snug text-foreground">{dayGranularitySummary}</p>
          <p className="text-[10px] leading-snug text-muted-foreground">{t('calendarNip52DayIndicesHint')}</p>
        </div>
      ) : null}

      {hasInclusions ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52CalendarInclusion')}
          </div>
          <ul className="min-w-0 space-y-1">
            {extras.calendarInclusions.map((row) => (
              <li key={row.coordinate}>
                <button
                  type="button"
                  onClick={() => navigateToNote(row.naddr)}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent py-0.5 text-left',
                    'text-xs text-primary hover:border-border/60 hover:bg-muted/40'
                  )}
                >
                  <Calendar className="size-3.5 shrink-0 opacity-90" aria-hidden />
                  <span className="min-w-0 break-all font-mono leading-snug">{row.naddr}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-snug text-muted-foreground">{t('calendarNip52CalendarInclusionHint')}</p>
        </div>
      ) : null}

      {hasR ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52References')}
          </div>
          <ul className="min-w-0 space-y-1">
            {extras.rTags.map((r, idx) => (
              <li key={`${r.value}-${idx}`} className="min-w-0">
                {r.isHttpUrl ? (
                  <a
                    href={r.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 max-w-full items-start gap-1 break-all text-xs font-medium text-primary underline-offset-2 hover:text-foreground hover:underline transition-colors"
                  >
                    <Link2 className="mt-0.5 size-3 shrink-0 opacity-80" aria-hidden />
                    <span>{r.value}</span>
                  </a>
                ) : (
                  <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1">
                    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Link2 className="mt-0.5 size-3 shrink-0" aria-hidden />
                      <span className="min-w-0 break-all font-mono text-foreground">{r.value}</span>
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasUnknown ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendarNip52OtherTags')}
          </div>
          <dl className="min-w-0 space-y-1.5 rounded-md border border-border/50 bg-muted/15 p-2">
            {extras.unknownTags.map((tag, idx) => (
              <div key={`${tag[0]}-${idx}`} className="grid gap-0.5 sm:grid-cols-[minmax(0,5.5rem)_1fr] sm:gap-2">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tag[0] || '—'}
                </dt>
                <dd className="min-w-0 break-all text-[11px] text-foreground">
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
