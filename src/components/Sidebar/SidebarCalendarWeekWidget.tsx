import {
  calendarOccurrenceOverlapsRange,
  dedupeCalendarEventsPreferringOccurrenceRange,
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
import { registerSessionInteractivePrewarmListener } from '@/services/session-interactive-prewarm-bridge'
import indexedDb from '@/services/indexed-db.service'
import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { type Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarEventCoverImage } from '@/components/CalendarEventCoverImage'
import { Button } from '@/components/ui/button'

/** Global calendar REQ: relays often cap; larger limit reduces “missing” older-published rows for this week. */
const FETCH_LIMIT = 400
/** Supplementary `authors` REQ: community calls (e.g. Edufeed) may not appear in the global slice. */
const FOLLOWING_CALENDAR_AUTHORS_CAP = 200
const FOLLOWING_CALENDAR_AUTHORS_CHUNK = 80
const FOLLOWING_CALENDAR_CHUNK_LIMIT = 350
/** ~5 note rows at ~48px each */
const LIST_MAX_HEIGHT_PX = 240
const SIDEBAR_CALENDAR_MAX_RELAYS = 24
/** Merge session cache so events already loaded in feeds (but missed by this REQ) still appear. */
const SESSION_CALENDAR_MERGE_CAP = 1200

export default function SidebarCalendarWeekWidget() {
  const { t } = useTranslation()
  const { relayList, pubkey } = useNostr()
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
    /** Sidebar only: avoid prepending {@link READ_ONLY_RELAY_URLS} so idle shell does not open aggregator sockets. */
    return base.slice(0, SIDEBAR_CALENDAR_MAX_RELAYS)
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

  const fetchGenRef = useRef(0)

  useEffect(() => {
    const fetchGen = ++fetchGenRef.current
    let cancelled = false
    let lateMergeTimer: number | null = null
    const stale = () => cancelled || fetchGenRef.current !== fetchGen

    const weekBounds = () => getLocalMondayWeekBounds(weekOffset)

    const replacePool = (pool: Event[]) => {
      if (stale()) return
      const { weekStartMs, weekEndExclusiveMs } = weekBounds()
      setRawEvents(dedupeCalendarEventsPreferringOccurrenceRange(pool, weekStartMs, weekEndExclusiveMs))
    }

    const mergeIntoPool = (incoming: Event[]) => {
      if (stale()) return
      const { weekStartMs, weekEndExclusiveMs } = weekBounds()
      setRawEvents((prev) =>
        dedupeCalendarEventsPreferringOccurrenceRange([...prev, ...incoming], weekStartMs, weekEndExclusiveMs)
      )
    }

    const { weekStartMs, weekEndExclusiveMs } = weekBounds()
    const fromSessionSync = client.getSessionEventsMatchingSearch(
      '',
      SESSION_CALENDAR_MERGE_CAP,
      [...CALENDAR_EVENT_KINDS]
    )
    replacePool(
      dedupeCalendarEventsPreferringOccurrenceRange(fromSessionSync, weekStartMs, weekEndExclusiveMs)
    )

    const scheduleLateSessionMerge = () => {
      lateMergeTimer = window.setTimeout(() => {
        lateMergeTimer = null
        if (stale()) return
        const later = client.getSessionEventsMatchingSearch(
          '',
          SESSION_CALENDAR_MERGE_CAP,
          [...CALENDAR_EVENT_KINDS]
        )
        mergeIntoPool(later)
      }, 2500)
    }

    void (async () => {
      try {
        const idbP = Promise.all([
          indexedDb.getCalendarEventsForOccurrenceWindow(weekStartMs, weekEndExclusiveMs, 8000),
          indexedDb.getArchivedCalendarEventsOverlappingWindow(weekStartMs, weekEndExclusiveMs, 25_000, 400)
        ])
          .then(([fromIdb, fromArchive]) =>
            dedupeCalendarEventsPreferringOccurrenceRange(
              [...fromIdb, ...fromArchive],
              weekStartMs,
              weekEndExclusiveMs
            )
          )
          .catch((): Event[] => [])

        if (stale()) return

        if (!relayUrls.length) {
          const localBaseline = await idbP
          if (stale()) return
          const fromSession = client.getSessionEventsMatchingSearch(
            '',
            SESSION_CALENDAR_MERGE_CAP,
            [...CALENDAR_EVENT_KINDS]
          )
          replacePool([...localBaseline, ...fromSession])
          scheduleLateSessionMerge()
          return
        }

        const authorList = followAuthorsKey
          ? followAuthorsKey.split('|').filter(Boolean).slice(0, FOLLOWING_CALENDAR_AUTHORS_CAP)
          : []
        const authorChunks: string[][] = []
        for (let i = 0; i < authorList.length; i += FOLLOWING_CALENDAR_AUTHORS_CHUNK) {
          authorChunks.push(authorList.slice(i, i + FOLLOWING_CALENDAR_AUTHORS_CHUNK))
        }

        const mainReq = client.fetchEvents(
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
        const chunkReqs = authorChunks.map((authors) =>
          client.fetchEvents(
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
        )

        const relayMergedP = Promise.all([mainReq, ...chunkReqs])
          .then((merged) => {
            const batch = merged[0] ?? []
            const fromFollowing: Event[] = []
            for (let i = 1; i < merged.length; i++) {
              fromFollowing.push(...(merged[i] ?? []))
            }
            return { batch, fromFollowing }
          })
          .catch(() => ({ batch: [] as Event[], fromFollowing: [] as Event[] }))

        const [{ batch, fromFollowing }, localBaseline] = await Promise.all([relayMergedP, idbP])
        if (stale()) return

        const fromSessionAfterNet = client.getSessionEventsMatchingSearch(
          '',
          SESSION_CALENDAR_MERGE_CAP,
          [...CALENDAR_EVENT_KINDS]
        )
        replacePool([...localBaseline, ...fromSessionAfterNet, ...batch, ...fromFollowing])
        scheduleLateSessionMerge()
      } catch {
        if (!stale()) {
          try {
            const { weekStartMs: ws, weekEndExclusiveMs: we } = weekBounds()
            const [idb, arc] = await Promise.all([
              indexedDb.getCalendarEventsForOccurrenceWindow(ws, we),
              indexedDb.getArchivedCalendarEventsOverlappingWindow(ws, we, 25_000, 400)
            ])
            const salvage = dedupeCalendarEventsPreferringOccurrenceRange([...idb, ...arc], ws, we)
            const fromSession = client.getSessionEventsMatchingSearch(
              '',
              SESSION_CALENDAR_MERGE_CAP,
              [...CALENDAR_EVENT_KINDS]
            )
            replacePool([...salvage, ...fromSession])
          } catch {
            if (!stale()) setRawEvents([])
          }
        }
      }
    })()
    return () => {
      cancelled = true
      if (lateMergeTimer != null) window.clearTimeout(lateMergeTimer)
    }
  }, [relayKey, followAuthorsKey, weekOffset, prewarmRefreshKey])

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
