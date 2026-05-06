import { getCalendarEventMeta, getCalendarOccurrenceWindowMs } from '@/lib/calendar-event'
import { readCalendarDayPanelEvents } from '@/lib/calendar-day-panel-cache'
import { replaceableEventDedupeKey } from '@/lib/event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useSmartNoteNavigation } from '@/PageManager'
import { TPageRef } from '@/types'
import { type Event } from 'nostr-tools'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

const CalendarDayEventsPage = forwardRef<TPageRef, { ymd: string; index?: number }>(function CalendarDayEventsPage(
  { ymd, index },
  ref
) {
  const { t, i18n } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const [events, setEvents] = useState<Event[]>([])

  const validYmd = typeof ymd === 'string' && YMD_RE.test(ymd)

  useEffect(() => {
    if (!validYmd) {
      setEvents([])
      return
    }
    setEvents(readCalendarDayPanelEvents(ymd) ?? [])
  }, [ymd, validYmd])

  const title = useMemo(() => {
    if (!validYmd) return t('calendarPageTitle')
    const [y, m, d] = ymd.split('-').map(Number)
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0)
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(dt)
  }, [ymd, validYmd, i18n.language])

  const sorted = useMemo(() => {
    return [...events].sort((a, b) => {
      const wa = getCalendarOccurrenceWindowMs(a)?.startMs ?? a.created_at * 1000
      const wb = getCalendarOccurrenceWindowMs(b)?.startMs ?? b.created_at * 1000
      return wa - wb
    })
  }, [events])

  useImperativeHandle(ref, () => ({
    scrollToTop: (behavior?: ScrollBehavior) => {
      window.scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
    }
  }))

  if (!validYmd) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('calendarPageTitle')}>
        <p className="px-4 py-6 text-sm text-muted-foreground">{t('calendarDayPanelInvalidDate')}</p>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={title} displayScrollToTopButton>
      <div className="min-w-0 px-3 py-3 md:px-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">{t('calendarDayPanelEmpty')}</p>
        ) : (
          <ul className="min-w-0 space-y-1">
            {sorted.map((ev) => {
              const meta = getCalendarEventMeta(ev)
              const label = meta.title?.trim() || t('calendarPageUntitledEvent')
              const cover = meta.image?.trim()
              return (
                <li key={replaceableEventDedupeKey(ev)}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'flex h-auto min-h-10 w-full items-center justify-start gap-3 whitespace-normal px-3 py-2 text-left text-sm font-medium'
                    )}
                    onClick={() => navigateToNote(toNote(ev), ev)}
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="size-9 shrink-0 rounded-md object-cover ring-1 ring-border/50"
                      />
                    ) : (
                      <div className="size-9 shrink-0 rounded-md bg-muted/60 ring-1 ring-border/40" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 leading-snug">{label}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SecondaryPageLayout>
  )
})

CalendarDayEventsPage.displayName = 'CalendarDayEventsPage'
export default CalendarDayEventsPage
