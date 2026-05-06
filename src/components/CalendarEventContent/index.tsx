import { createCalendarRsvpDraftEvent } from '@/lib/draft-event'
import {
  getCalendarEventMeta,
  formatCalendarTimeRange,
  formatCalendarDateRange,
  isCalendarEventKind
} from '@/lib/calendar-event'
import { tagNameEquals } from '@/lib/tag'
import { useFetchCalendarRsvps } from '@/hooks/useFetchCalendarRsvps'
import { useNostr } from '@/providers/NostrProvider'
import { toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import Collapsible from '../Collapsible'
import { Button } from '../ui/button'
import { Calendar, Clock, ExternalLink, MapPin, CheckCircle, HelpCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import { toast } from 'sonner'

type RsvpStatus = 'accepted' | 'tentative' | 'declined'

export default function CalendarEventContent({
  event,
  className,
  showRsvp = true,
  showFull = false
}: {
  event: Event
  className?: string
  showRsvp?: boolean
  /** Note page / full detail: markdown body + complete tag list. */
  showFull?: boolean
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey: myPubkey, publish } = useNostr()
  const { rsvps, isFetching, getRsvpStatus: getStatus } = useFetchCalendarRsvps(event)

  const meta = useMemo(() => {
    if (!isCalendarEventKind(event.kind)) return null
    return getCalendarEventMeta(event)
  }, [event])

  const markdownBody = useMemo(() => {
    if (!meta) return ''
    const s = meta.summary.trim()
    const c = event.content?.trim() ?? ''
    if (s && c) return `${s}\n\n${c}`
    return s || c || ''
  }, [meta, event.content])

  const eventForMarkdown = useMemo((): Event => {
    if (!markdownBody) return event
    return { ...event, content: markdownBody }
  }, [event, markdownBody])

  const duplicateWebPreviewHints = useMemo(
    () =>
      !meta ? [] : [...meta.rUrls, ...(meta.image?.trim() ? [meta.image.trim()] : [])],
    [meta]
  )

  const myRsvp = myPubkey ? rsvps.find((r) => r.pubkey === myPubkey) : undefined
  const myStatus = myRsvp ? getStatus(myRsvp) : undefined

  // Organizer + invitees (event p tags) + anyone who sent an RSVP. Each shows response: accepted/tentative/declined or no response.
  const attendeesList = useMemo(() => {
    const organizerPubkey = event.pubkey
    const participantPubkeys = event.tags
      .filter(tagNameEquals('p'))
      .map((t) => t[1]?.trim())
      .filter(Boolean) as string[]
    const allPubkeys = Array.from(
      new Set([organizerPubkey, ...participantPubkeys, ...rsvps.map((r) => r.pubkey)])
    )
    return allPubkeys.map((pubkey) => {
      const rsvp = rsvps.find((r) => r.pubkey === pubkey)
      return {
        pubkey,
        status: (rsvp ? getStatus(rsvp) : null) as RsvpStatus | null,
        isOrganizer: pubkey === organizerPubkey
      }
    })
  }, [event.pubkey, event.tags, rsvps])

  if (!meta) return null

  const {
    title,
    image,
    start,
    end,
    startDate,
    endDate,
    isDateBased,
    rUrls,
    location,
    startTzid,
    endTzid,
    topics
  } = meta

  const handleRsvp = async (status: RsvpStatus) => {
    if (!myPubkey) {
      toast.error(t('You need to log in to RSVP'))
      return
    }
    try {
      const draft = createCalendarRsvpDraftEvent(event, status)
      await publish(draft)
      toast.success(t('RSVP updated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to update RSVP'))
    }
  }

  const scheduleLine = isDateBased
    ? (startDate || endDate) && formatCalendarDateRange(startDate, endDate)
    : start != null && !isNaN(start)
      ? formatCalendarTimeRange(start, end != null && !isNaN(end) ? end : undefined)
      : null

  return (
    <div
      className={cn(
        'min-w-0 space-y-3 rounded-xl border border-border/70 bg-gradient-to-b from-card to-muted/25 p-4 text-sm shadow-sm',
        className
      )}
      data-calendar-event-content
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn(
              'shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-border/40',
              showFull ? 'size-[4.5rem]' : 'size-10'
            )}
          />
        ) : (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-border/40',
              showFull ? 'size-[4.5rem]' : 'size-10'
            )}
          >
            <Calendar
              className={cn('text-primary/80', showFull ? 'size-7' : 'size-5')}
              aria-hidden
            />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <h3
            className={cn(
              'font-semibold leading-snug tracking-tight text-foreground',
              showFull ? 'text-lg' : 'line-clamp-2 text-base'
            )}
          >
            {title || t('Scheduled video call')}
          </h3>
          {!showFull && scheduleLine ? (
            <p className="flex items-start gap-1.5 text-xs font-medium leading-snug text-foreground">
              <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">{scheduleLine}</span>
            </p>
          ) : null}
          {!showFull && location ? (
            <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 line-clamp-3">{location}</span>
            </p>
          ) : null}
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border/50"
                >
                  #{topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {showFull && scheduleLine ? (
        <div className="flex gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium leading-snug text-foreground">{scheduleLine}</p>
            {(startTzid || endTzid) && (
              <p className="text-xs leading-snug text-muted-foreground">
                {startTzid ? (
                  <>
                    <span className="font-medium text-foreground/80">start_tzid</span>: {startTzid}
                  </>
                ) : null}
                {startTzid && endTzid && endTzid !== startTzid ? ' · ' : ''}
                {endTzid && endTzid !== startTzid ? (
                  <>
                    <span className="font-medium text-foreground/80">end_tzid</span>: {endTzid}
                  </>
                ) : null}
              </p>
            )}
          </div>
        </div>
      ) : null}
      {showFull && location ? (
        <div className="flex gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-sm leading-snug text-foreground">{location}</p>
        </div>
      ) : null}
      {markdownBody ? (
        showFull ? (
          <div className="not-prose min-w-0 border-t border-border/50 pt-3" data-calendar-event-markdown>
            <MarkdownArticle
              event={eventForMarkdown}
              className="prose-sm"
              hideMetadata
              lazyMedia={false}
              duplicateWebPreviewCleanedUrlHints={duplicateWebPreviewHints}
            />
          </div>
        ) : (
          <>
            {/* NIP-52 31922/31923: collapse long summary+body only; card chrome stays outside MainNoteCard Collapsible. */}
            <Collapsible threshold={200} collapsedHeight={160} className="min-w-0">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {markdownBody}
              </p>
            </Collapsible>
          </>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {rUrls.map((url) => (
          <Button key={url} variant="secondary" size="sm" className="gap-2" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 shrink-0" />
              {t('Open link')}
            </a>
          </Button>
        ))}
        {showRsvp && myPubkey && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isFetching}
              >
                {myStatus === 'accepted' && <CheckCircle className="size-4 text-green-600" />}
                {myStatus === 'tentative' && <HelpCircle className="size-4 text-amber-600" />}
                {myStatus === 'declined' && <XCircle className="size-4 text-muted-foreground" />}
                {myStatus
                  ? t('RSVP: {{status}}', { status: myStatus })
                  : t('RSVP')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleRsvp('accepted')}>
                <CheckCircle className="size-4 mr-2 text-green-600" />
                {t('Accepted')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRsvp('tentative')}>
                <HelpCircle className="size-4 mr-2 text-amber-600" />
                {t('Tentative')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRsvp('declined')}>
                <XCircle className="size-4 mr-2" />
                {t('Declined')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {attendeesList.length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Attendees')}
          </div>
          <ul className="space-y-1">
            {attendeesList.map(({ pubkey, status, isOrganizer }) => (
              <li key={pubkey}>
                <button
                  type="button"
                  onClick={() => push(toProfile(pubkey))}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors',
                    'hover:bg-muted/50'
                  )}
                >
                  <UserAvatar userId={pubkey} size="xSmall" className="shrink-0" />
                  <span className="min-w-0 truncate flex-1">
                    <Username userId={pubkey} className="text-foreground" skeletonClassName="h-3" />
                  </span>
                  <span className="shrink-0 flex items-center gap-1.5 text-muted-foreground">
                    {isOrganizer && (
                      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {t('Organizer')}
                      </span>
                    )}
                    {status === 'accepted' && (
                      <span className="flex items-center gap-1 text-green-600" title={t('Accepted')}>
                        <CheckCircle className="size-3.5" />
                        <span className="text-[10px]">{t('Accepted')}</span>
                      </span>
                    )}
                    {status === 'tentative' && (
                      <span className="flex items-center gap-1 text-amber-600" title={t('Tentative')}>
                        <HelpCircle className="size-3.5" />
                        <span className="text-[10px]">{t('Tentative')}</span>
                      </span>
                    )}
                    {status === 'declined' && (
                      <span className="flex items-center gap-1 text-muted-foreground" title={t('Declined')}>
                        <XCircle className="size-3.5" />
                        <span className="text-[10px]">{t('Declined')}</span>
                      </span>
                    )}
                    {status == null && (
                      <span className="text-[10px] italic text-muted-foreground">
                        {t('No response')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showFull && event.tags.length > 0 ? (
        <div className="border-t border-border/50 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('All tags')}
          </div>
          <dl className="min-w-0 space-y-2">
            {event.tags.map((tag, idx) => (
              <div key={`${tag[0]}-${idx}`} className="grid gap-1 sm:grid-cols-[minmax(0,7rem)_1fr] sm:gap-3">
                <dt className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
