import {
  calendarOccurrenceOverlapsRange,
  dedupeCalendarEventsPreferringOccurrenceRange,
  formatCalendarSidebarRow,
  formatSidebarWeekLabel,
  getCalendarEventMeta,
  getCalendarOccurrenceWindowMs,
  getLocalMondayWeekBounds
} from '@/lib/calendar-event'
import { startCalendarFeedLoad } from '@/lib/calendar-feed-load'
import { replaceableEventDedupeKey } from '@/lib/event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSmartNoteNavigation } from '@/PageManager'
import { buildCalendarReadRelayUrls } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFollowListOptional } from '@/providers/follow-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { registerSessionInteractivePrewarmListener } from '@/services/session-interactive-prewarm-bridge'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { type Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarEventCoverImage } from '@/components/CalendarEventCoverImage'
import { Button } from '@/components/ui/button'

const FETCH_LIMIT = 400
const SESSION_CALENDAR_MERGE_CAP = 1200
/** ~5 note rows at ~48px each */
const LIST_MAX_HEIGHT_PX = 240

export default function SidebarCalendarWeekWidget() {
  const { t } = useTranslation()
  const { relayList, cacheRelayListEvent, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followList = useFollowListOptional()
  const { navigateToNote } = useSmartNoteNavigation()
  const { navigate: navigatePrimary } = usePrimaryPage()

  const [prewarmRefreshKey, bumpPrewarmRefresh] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return registerSessionInteractivePrewarmListener(() => {
      bumpPrewarmRefresh()
    })
  }, [])

  const [weekOffset, setWeekOffset] = useState(0)
  const [rawEvents, setRawEvents] = useState<Event[]>([])

  const relayUrls = useMemo(
    () =>
      buildCalendarReadRelayUrls(
        favoriteRelays,
        blockedRelays,
        userReadInboxUrls(relayList, cacheRelayListEvent),
        userWriteOutboxUrls(relayList, cacheRelayListEvent),
        { includeReadOnlyMirrors: false }
      ),
    [favoriteRelays, blockedRelays, relayList, cacheRelayListEvent]
  )

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

  const fetchGenRef = useRef(0)

  useEffect(() => {
    const fetchGen = ++fetchGenRef.current
    const stale = () => fetchGenRef.current !== fetchGen
    const { weekStartMs, weekEndExclusiveMs } = getLocalMondayWeekBounds(weekOffset)

    const cleanup = startCalendarFeedLoad({
      relayUrls,
      rangeStartMs: weekStartMs,
      rangeEndExclusiveMs: weekEndExclusiveMs,
      followAuthorsKey,
      fetchLimit: FETCH_LIMIT,
      sessionMergeCap: SESSION_CALENDAR_MERGE_CAP,
      idbMaxScan: 8000,
      archiveMaxScan: 25_000,
      archiveMaxMatches: 400,
      mainFetchGlobalTimeout: 22_000,
      mainFetchEoseTimeout: 3500,
      chunkFetchGlobalTimeout: 16_000,
      chunkFetchEoseTimeout: 2800,
      isStale: stale,
      onReplace: (pool) => {
        setRawEvents(
          dedupeCalendarEventsPreferringOccurrenceRange(pool, weekStartMs, weekEndExclusiveMs)
        )
      },
      onMerge: (incoming) => {
        setRawEvents((prev) =>
          dedupeCalendarEventsPreferringOccurrenceRange(
            [...prev, ...incoming],
            weekStartMs,
            weekEndExclusiveMs
          )
        )
      }
    })

    return cleanup
  }, [relayKey, followAuthorsKey, weekOffset, prewarmRefreshKey, relayUrls])

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
      {sortedForWeek.length > 0 ? (
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
      ) : !relayUrls.length ? (
        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">{t('sidebarCalendarNoRelays')}</p>
      ) : (
        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">{t('sidebarCalendarEmptyWeek')}</p>
      )}
    </div>
  )
}
