import {
  getCalendarEventMeta,
  formatCalendarTimeRange,
  formatCalendarDateRange,
  isCalendarEventKind
} from '@/lib/calendar-event'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import Collapsible from '../Collapsible'
import { Button } from '../ui/button'
import { Calendar, Clock, Video } from 'lucide-react'

export function EmbeddedCalendarEvent({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  if (!isCalendarEventKind(event.kind)) return null
  const { title, summary, image, start, end, startDate, endDate, isDateBased, joinUrl, topics } =
    getCalendarEventMeta(event)
  const description = summary || event.content?.trim() || ''

  const scheduleLine = isDateBased
    ? (startDate || endDate) && formatCalendarDateRange(startDate, endDate)
    : start != null && !isNaN(start)
      ? formatCalendarTimeRange(start, end != null && !isNaN(end) ? end : undefined)
      : null

  return (
    <div
      className={cn(
        'min-w-0 space-y-2.5 rounded-xl border border-border/70 bg-gradient-to-b from-card to-muted/25 p-3 text-sm shadow-sm',
        className
      )}
      data-embedded-calendar-event
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2.5">
        {image ? (
          <img
            src={image}
            alt=""
            className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-border/40"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-border/40">
            <Calendar className="size-6 text-primary/80" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <span className="block truncate font-semibold leading-snug text-foreground">
            {title || t('Scheduled video call')}
          </span>
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center rounded-full bg-muted/80 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border/50"
                >
                  #{topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {scheduleLine ? (
        <div className="flex gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-xs font-medium leading-snug text-foreground">{scheduleLine}</p>
        </div>
      ) : null}
      {description ? (
        <>
          {/* NIP-52 31922/31923 embedded preview: long description only. */}
          <Collapsible threshold={180} collapsedHeight={120} className="min-w-0">
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </Collapsible>
        </>
      ) : null}
      {joinUrl && (
        <Button
          variant="secondary"
          size="sm"
          className="w-full gap-2 mt-1"
          asChild
        >
          <a href={joinUrl} target="_blank" rel="noopener noreferrer">
            <Video className="size-4" />
            {t('Join video call')}
          </a>
        </Button>
      )}
    </div>
  )
}
