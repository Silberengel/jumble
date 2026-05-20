import { createCalendarRsvpDraftEvent } from '@/lib/draft-event'
import { getUsingClient } from '@/lib/event'
import {
  getCalendarEventMeta,
  getNip52CalendarEventTagExtras,
  formatCalendarTimeRange,
  formatCalendarDateRange,
  isCalendarEventKind,
  stripCalendarEventRedundantTopicHashtagLines
} from '@/lib/calendar-event'
import { tagNameEquals } from '@/lib/tag'
import { useFetchCalendarRsvps } from '@/hooks/useFetchCalendarRsvps'
import { useNostr } from '@/providers/NostrProvider'
import { toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { CalendarEventCoverImage } from '@/components/CalendarEventCoverImage'
import { CalendarEventNip52StructuredMeta } from '@/components/CalendarEventNip52StructuredMeta'
import ClientTag from '@/components/ClientTag'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import Collapsible from '../Collapsible'
import { Button } from '../ui/button'
import { Clock, ExternalLink, MapPin, CheckCircle, HelpCircle, XCircle } from 'lucide-react'
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
    if (showFull) {
      if (s && c) return c
      return s || c || ''
    }
    if (s && c) return `${s}\n\n${c}`
    return s || c || ''
  }, [meta, event.content, showFull])

  const markdownBodyDeduped = useMemo(() => {
    const topicList = meta?.topics ?? []
    return stripCalendarEventRedundantTopicHashtagLines(markdownBody, topicList)
  }, [markdownBody, meta])

  const eventForMarkdown = useMemo((): Event => {
    if (!markdownBodyDeduped) return event
    return { ...event, content: markdownBodyDeduped }
  }, [event, markdownBodyDeduped])

  const duplicateWebPreviewHints = useMemo(() => {
    if (!meta) return []
    const httpRs = getNip52CalendarEventTagExtras(event)
      .rTags.filter((r) => r.isHttpUrl)
      .map((r) => r.value)
    return [...httpRs, ...(meta.image?.trim() ? [meta.image.trim()] : [])]
  }, [meta, event])

  const myRsvp = myPubkey ? rsvps.find((r) => r.pubkey === myPubkey) : undefined
  const myStatus = myRsvp ? getStatus(myRsvp) : undefined

  // Organizer + invitees (event p tags) + anyone who sent an RSVP. Each shows response: accepted/tentative/declined or no response.
  const attendeesList = useMemo(() => {
    const organizerPubkey = event.pubkey
    const roleByPubkey = new Map<string, string>()
    for (const t of event.tags.filter(tagNameEquals('p'))) {
      const pk = t[1]?.trim()
      const role = t[3]?.trim()
      if (pk && role && !roleByPubkey.has(pk)) roleByPubkey.set(pk, role)
    }
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
        role: roleByPubkey.get(pubkey),
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
        'min-w-0 rounded-xl border border-border/70 bg-gradient-to-b from-card to-muted/25 text-sm shadow-sm',
        showFull ? 'space-y-2.5 p-3' : 'space-y-3 p-4',
        className
      )}
      data-calendar-event-content
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        {!showFull ? (
          <CalendarEventCoverImage
            coverUrl={image}
            pubkey={event.pubkey}
            className="size-10 shrink-0 rounded-lg"
            iconClassName="size-5"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          <h3
            className={cn(
              'font-semibold leading-snug tracking-tight text-foreground',
              showFull ? 'text-lg' : 'line-clamp-2 text-base'
            )}
          >
            {title || t('Scheduled video call')}
          </h3>
          {getUsingClient(event) ? (
            <div className="min-w-0">
              <ClientTag event={event} />
            </div>
          ) : null}
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
        <div className="flex gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium leading-snug text-foreground">{scheduleLine}</p>
            {(startTzid || endTzid) && (
              <p className="text-xs leading-snug text-muted-foreground">
                {startTzid ? (
                  <>
                    <span className="font-medium text-foreground/80">{t('Start time-zone id')}</span>: {startTzid}
                  </>
                ) : null}
                {startTzid && endTzid && endTzid !== startTzid ? ' · ' : ''}
                {endTzid && endTzid !== startTzid ? (
                  <>
                    <span className="font-medium text-foreground/80">{t('End time-zone id')}</span>: {endTzid}
                  </>
                ) : null}
              </p>
            )}
          </div>
        </div>
      ) : null}
      {showFull ? (
        <CalendarEventNip52StructuredMeta
          placement="beforeDescription"
          event={event}
          meta={meta}
          isDateBased={isDateBased}
        />
      ) : null}
      {markdownBodyDeduped ? (
        showFull ? (
          <div className="not-prose min-w-0 border-t border-border/50 pt-2" data-calendar-event-markdown>
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
                {markdownBodyDeduped}
              </p>
            </Collapsible>
          </>
        )
      ) : null}
      {showFull ? (
        <CalendarEventNip52StructuredMeta
          placement="afterDescription"
          event={event}
          meta={meta}
          isDateBased={isDateBased}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-2">
        {!showFull &&
          rUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:text-foreground hover:underline transition-colors"
            >
              <ExternalLink className="size-3 shrink-0 opacity-80" aria-hidden />
              {t('Open link')}
            </a>
          ))}
        {showRsvp && myPubkey && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size={showFull ? 'lg' : 'default'}
                className={cn(
                  'font-semibold shadow-md',
                  showFull && 'w-full min-w-0 sm:w-auto sm:min-w-[11rem]'
                )}
                disabled={isFetching}
              >
                {myStatus === 'accepted' && (
                  <CheckCircle className="size-4 shrink-0 text-primary-foreground opacity-95" aria-hidden />
                )}
                {myStatus === 'tentative' && (
                  <HelpCircle className="size-4 shrink-0 text-primary-foreground opacity-95" aria-hidden />
                )}
                {myStatus === 'declined' && (
                  <XCircle className="size-4 shrink-0 text-primary-foreground opacity-90" aria-hidden />
                )}
                {myStatus ? t('RSVP: {{status}}', { status: myStatus }) : t('RSVP')}
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
            {attendeesList.map(({ pubkey, status, isOrganizer, role }) => (
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
                  <span className="min-w-0 flex-1 truncate">
                    <Username userId={pubkey} className="text-foreground" skeletonClassName="h-3" />
                    {role ? (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{role}</span>
                    ) : null}
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
    </div>
  )
}
