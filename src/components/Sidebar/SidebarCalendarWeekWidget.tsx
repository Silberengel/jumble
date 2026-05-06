import {
  calendarOccurrenceOverlapsRange,
  formatCalendarSidebarRow,
  formatSidebarWeekLabel,
  getCalendarEventMeta,
  getCalendarOccurrenceWindowMs,
  getLocalMondayWeekBounds
} from '@/lib/calendar-event'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { replaceableEventDedupeKey } from '@/lib/event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSmartNoteNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFollowListOptional } from '@/providers/follow-list-context'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { type Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarEventCoverImage } from '@/components/CalendarEventCoverImage'
import { Button } from '@/components/ui/button'

/** Global calendar REQ: relays often cap; larger limit reduces “missing” older-published rows for this week. */
const FETCH_LIMIT = 1200
/** Supplementary `authors` REQ: community calls (e.g. Edufeed) may not appear in the global slice. */
const FOLLOWING_CALENDAR_AUTHORS_CAP = 200
const FOLLOWING_CALENDAR_AUTHORS_CHUNK = 80
const FOLLOWING_CALENDAR_CHUNK_LIMIT = 350
/** ~5 note rows at ~48px each */
const LIST_MAX_HEIGHT_PX = 240
const SIDEBAR_CALENDAR_MAX_RELAYS = 24
/** Merge session cache so events already loaded in feeds (but missed by this REQ) still appear. */
const SESSION_CALENDAR_MERGE_CAP = 5000

function dedupeCalendarEvents(events: Event[]): Event[] {
  const map = new Map<string, Event>()
  for (const e of events) {
    const k = replaceableEventDedupeKey(e)
    const prev = map.get(k)
    if (!prev || e.created_at > prev.created_at) map.set(k, e)
  }
  return [...map.values()]
}

export default function SidebarCalendarWeekWidget() {
  const { t } = useTranslation()
  const { relayList, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followList = useFollowListOptional()
  const { navigateToNote } = useSmartNoteNavigation()
  const { navigate: navigatePrimary } = usePrimaryPage()

  const [weekOffset, setWeekOffset] = useState(0)
  const [rawEvents, setRawEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)

  const relayUrls = useMemo(() => {
    const base = getRelayUrlsWithFavoritesFastReadAndInbox(
      favoriteRelays,
      blockedRelays,
      userReadRelaysWithHttp(relayList),
      {
        userWriteRelays: relayList?.write ?? [],
        applySocialKindBlockedFilter: false
      }
    )
    return appendCuratedReadOnlyRelays(base, blockedRelays).slice(0, SIDEBAR_CALENDAR_MAX_RELAYS)
  }, [favoriteRelays, blockedRelays, relayList])

  const relayKey = useMemo(() => [...relayUrls].sort().join('|'), [relayUrls])

  const followAuthorsKey = useMemo(() => {
    const raw = followList?.followings ?? []
    if (!raw.length && !pubkey) return ''
    const set = new Set<string>()
    for (const p of raw) {
      const k = p?.trim().toLowerCase()
      if (k) set.add(k)
    }
    if (pubkey) set.add(pubkey.toLowerCase())
    return [...set].sort().join('|')
  }, [followList?.followings, pubkey])

  const { weekLabel, sortedForWeek } = useMemo(() => {
    const { weekStartMs: ws, weekEndExclusiveMs: we } = getLocalMondayWeekBounds(weekOffset)
    const label = formatSidebarWeekLabel(ws, we)
    const rows: { event: Event; sortKey: number }[] = []
    for (const ev of rawEvents) {
      if (!calendarOccurrenceOverlapsRange(ev, ws, we)) continue
      const win = getCalendarOccurrenceWindowMs(ev)
      if (!win) continue
      rows.push({ event: ev, sortKey: win.startMs })
    }
    rows.sort((a, b) => a.sortKey - b.sortKey)
    return {
      weekLabel: label,
      sortedForWeek: rows.map((r) => r.event)
    }
  }, [rawEvents, weekOffset])

  useEffect(() => {
    let cancelled = false
    let lateMergeTimer: number | null = null
    setLoading(true)
    void (async () => {
      try {
        const { weekStartMs, weekEndExclusiveMs } = getLocalMondayWeekBounds(weekOffset)
        const fromIdb = await indexedDb.getCalendarEventsForOccurrenceWindow(weekStartMs, weekEndExclusiveMs)

        if (!relayUrls.length) {
          if (cancelled) return
          const fromSession = client.getSessionEventsMatchingSearch(
            '',
            SESSION_CALENDAR_MERGE_CAP,
            [...CALENDAR_EVENT_KINDS]
          )
          setRawEvents(dedupeCalendarEvents([...fromIdb, ...fromSession]))
          lateMergeTimer = window.setTimeout(() => {
            lateMergeTimer = null
            if (cancelled) return
            const later = client.getSessionEventsMatchingSearch(
              '',
              SESSION_CALENDAR_MERGE_CAP,
              [...CALENDAR_EVENT_KINDS]
            )
            setRawEvents((prev) => dedupeCalendarEvents([...prev, ...later, ...fromIdb]))
          }, 2500)
          return
        }

        const batch = await client.fetchEvents(
          relayUrls,
          {
            kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
            limit: FETCH_LIMIT
          },
          {
            cache: true,
            globalTimeout: 22_000,
            eoseTimeout: 3500,
            firstRelayResultGraceMs: false
          }
        )
        if (cancelled) return

        const fromFollowing: Event[] = []
        if (followAuthorsKey) {
          const authorList = followAuthorsKey.split('|').filter(Boolean).slice(0, FOLLOWING_CALENDAR_AUTHORS_CAP)
          for (let i = 0; i < authorList.length; i += FOLLOWING_CALENDAR_AUTHORS_CHUNK) {
            const authors = authorList.slice(i, i + FOLLOWING_CALENDAR_AUTHORS_CHUNK)
            const chunk = await client.fetchEvents(
              relayUrls,
              {
                kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
                authors,
                limit: FOLLOWING_CALENDAR_CHUNK_LIMIT
              },
              {
                cache: true,
                globalTimeout: 16_000,
                eoseTimeout: 2800,
                firstRelayResultGraceMs: false
              }
            )
            if (cancelled) return
            fromFollowing.push(...chunk)
          }
        }

        const fromSession = client.getSessionEventsMatchingSearch(
          '',
          SESSION_CALENDAR_MERGE_CAP,
          [...CALENDAR_EVENT_KINDS]
        )
        setRawEvents(dedupeCalendarEvents([...batch, ...fromFollowing, ...fromSession, ...fromIdb]))
        lateMergeTimer = window.setTimeout(() => {
          lateMergeTimer = null
          if (cancelled) return
          const later = client.getSessionEventsMatchingSearch(
            '',
            SESSION_CALENDAR_MERGE_CAP,
            [...CALENDAR_EVENT_KINDS]
          )
          setRawEvents((prev) => dedupeCalendarEvents([...prev, ...later]))
        }, 2500)
      } catch {
        if (!cancelled) setRawEvents([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (lateMergeTimer != null) window.clearTimeout(lateMergeTimer)
    }
  }, [relayKey, followAuthorsKey, weekOffset])

  const openEvent = useCallback(
    (ev: Event) => {
      navigateToNote(toNote(ev), ev)
    },
    [navigateToNote]
  )

  return (
    <div className="max-xl:hidden w-full min-w-0 rounded-lg border border-border/60 bg-card/40 px-2 py-2 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('sidebarCalendarPreviousWeek')}
          onClick={() => setWeekOffset((w) => w - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span
          className="min-w-0 flex-1 truncate text-center text-[11px] font-semibold leading-tight text-foreground"
          title={weekLabel}
        >
          {weekLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('sidebarCalendarOpenMonthView')}
          title={t('sidebarCalendarOpenMonthView')}
          onClick={() => navigatePrimary('calendar', { weekOffset })}
        >
          <CalendarDays className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('sidebarCalendarNextWeek')}
          onClick={() => setWeekOffset((w) => w + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="mb-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('sidebarCalendarHeading')}
      </p>
      {loading && sortedForWeek.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span className="text-[11px]">{t('sidebarCalendarLoading')}</span>
        </div>
      ) : !relayUrls.length ? (
        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">{t('sidebarCalendarNoRelays')}</p>
      ) : sortedForWeek.length === 0 ? (
        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">{t('sidebarCalendarEmptyWeek')}</p>
      ) : (
        <ul className="min-w-0 space-y-1 overflow-y-auto pr-0.5" style={{ maxHeight: LIST_MAX_HEIGHT_PX }}>
          {sortedForWeek.map((ev) => {
            const meta = getCalendarEventMeta(ev)
            const title = meta.title?.trim() || t('Scheduled video call')
            const sub = formatCalendarSidebarRow(ev)
            return (
              <li key={replaceableEventDedupeKey(ev)}>
                <button
                  type="button"
                  onClick={() => openEvent(ev)}
                  className={cn(
                    'flex w-full gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-left transition-colors',
                    'hover:border-border/80 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <CalendarEventCoverImage
                    coverUrl={meta.image}
                    pubkey={ev.pubkey}
                    className="size-8 shrink-0 rounded-md ring-1 ring-border/40"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[11px] font-medium leading-snug text-foreground">{title}</span>
                    {sub ? (
                      <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                        {sub}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
