import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import {
  calendarOccurrenceOverlapsRange,
  dedupeCalendarEventsPreferringOccurrenceRange,
  getCalendarEventMeta,
  getLocalMondayWeekBounds,
  getLocalMonthRangeMs
} from '@/lib/calendar-event'
import { replaceableEventDedupeKey } from '@/lib/event'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { setCalendarDayPanelEvents } from '@/lib/calendar-day-panel-cache'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/contexts/secondary-page-context'
import { useSmartNoteNavigation } from '@/PageManager'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFollowListOptional } from '@/providers/follow-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import { TPageRef } from '@/types'
import { CalendarEventCoverImage } from '@/components/CalendarEventCoverImage'
import { RefreshButton } from '@/components/RefreshButton'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { type Event as NostrEvent } from 'nostr-tools'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const FETCH_LIMIT = 1200
const FOLLOWING_CALENDAR_AUTHORS_CAP = 200
const FOLLOWING_CALENDAR_AUTHORS_CHUNK = 80
const FOLLOWING_CALENDAR_CHUNK_LIMIT = 350
const SESSION_CALENDAR_MERGE_CAP = 5000
const SIDEBAR_CALENDAR_MAX_RELAYS = 24
const MONTH_IDB_MAX_SCAN = 12_000
const PAD_DAYS = 7

export type CalendarPrimaryPageProps = {
  /** Week offset from the current local week (same as sidebar widget). */
  weekOffset?: number
}

function mondayFirstOffsetFromMonthStart(year: number, monthIndex: number): number {
  const first = new Date(year, monthIndex, 1, 0, 0, 0, 0)
  const dow = first.getDay()
  return dow === 0 ? 6 : dow - 1
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function ymdForLocalDay(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const CalendarPrimaryPage = forwardRef<TPageRef, CalendarPrimaryPageProps>(function CalendarPrimaryPage(
  { weekOffset: weekOffsetProp = 0 },
  ref
) {
  const { t, i18n } = useTranslation()
  const { relayList, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followList = useFollowListOptional()
  const { navigateToNote } = useSmartNoteNavigation()
  const { push } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const [panelMode, setPanelMode] = useState<'single' | 'double'>(() => storage.getPanelMode())
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const onPanelMode = (ev: Event) => {
      const d = (ev as CustomEvent<{ mode: 'single' | 'double' }>).detail?.mode
      if (d === 'single' || d === 'double') setPanelMode(d)
    }
    window.addEventListener('panelModeChanged', onPanelMode)
    return () => window.removeEventListener('panelModeChanged', onPanelMode)
  }, [])

  /** Month grid is unreadable in the narrow primary column of double-pane; use the same vertical layout as mobile. */
  const useVerticalMonthCalendar = isSmallScreen || panelMode === 'double'

  const [activeWeekOffset, setActiveWeekOffset] = useState(weekOffsetProp)
  useEffect(() => {
    setActiveWeekOffset(weekOffsetProp)
  }, [weekOffsetProp])

  const highlightBounds = useMemo(
    () => getLocalMondayWeekBounds(activeWeekOffset),
    [activeWeekOffset]
  )

  const anchorMonday = useMemo(() => new Date(highlightBounds.weekStartMs), [highlightBounds.weekStartMs])
  const [viewYear, setViewYear] = useState(() => anchorMonday.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => anchorMonday.getMonth())

  useEffect(() => {
    const d = new Date(highlightBounds.weekStartMs)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }, [highlightBounds.weekStartMs])

  const [rawEvents, setRawEvents] = useState<NostrEvent[]>([])
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

  const paddedMonthRange = useMemo(() => {
    const { startMs, endExclusiveMs } = getLocalMonthRangeMs(viewYear, viewMonth)
    const pad = PAD_DAYS * 86_400_000
    return { rangeStartMs: startMs - pad, rangeEndExclusiveMs: endExclusiveMs + pad }
  }, [viewYear, viewMonth])

  useEffect(() => {
    let cancelled = false
    let lateMergeTimer: number | null = null
    const { rangeStartMs, rangeEndExclusiveMs } = paddedMonthRange

    /** Same-tick paint from in-memory session (no await) — IDB + relays merge in the async block below. */
    const fromSessionSync = client.getSessionEventsMatchingSearch(
      '',
      SESSION_CALENDAR_MERGE_CAP,
      [...CALENDAR_EVENT_KINDS]
    )
    const sessionOnly = dedupeCalendarEventsPreferringOccurrenceRange(
      fromSessionSync,
      rangeStartMs,
      rangeEndExclusiveMs
    )
    setRawEvents(sessionOnly)
    setLoading(false)

    const scheduleLateSessionMerge = (mergeWithIdb: NostrEvent[]) => {
      lateMergeTimer = window.setTimeout(() => {
        lateMergeTimer = null
        if (cancelled) return
        const later = client.getSessionEventsMatchingSearch(
          '',
          SESSION_CALENDAR_MERGE_CAP,
          [...CALENDAR_EVENT_KINDS]
        )
        setRawEvents((prev) =>
          dedupeCalendarEventsPreferringOccurrenceRange(
            [...prev, ...later, ...mergeWithIdb],
            rangeStartMs,
            rangeEndExclusiveMs
          )
        )
      }, 2500)
    }

    void (async () => {
      try {
        const idbP = Promise.all([
          indexedDb.getCalendarEventsForOccurrenceWindow(
            rangeStartMs,
            rangeEndExclusiveMs,
            MONTH_IDB_MAX_SCAN
          ),
          indexedDb.getArchivedCalendarEventsOverlappingWindow(
            rangeStartMs,
            rangeEndExclusiveMs,
            55_000,
            2500
          )
        ])
          .then(([fromIdb, fromArchive]) =>
            dedupeCalendarEventsPreferringOccurrenceRange(
              [...fromIdb, ...fromArchive],
              rangeStartMs,
              rangeEndExclusiveMs
            )
          )
          .catch((): NostrEvent[] => [])

        void idbP.then((localBaseline) => {
          if (cancelled) return
          const s2 = client.getSessionEventsMatchingSearch(
            '',
            SESSION_CALENDAR_MERGE_CAP,
            [...CALENDAR_EVENT_KINDS]
          )
          setRawEvents(
            dedupeCalendarEventsPreferringOccurrenceRange(
              [...localBaseline, ...s2],
              rangeStartMs,
              rangeEndExclusiveMs
            )
          )
        })

        if (!relayUrls.length) {
          void idbP.then((lb) => {
            if (!cancelled) scheduleLateSessionMerge(lb)
          })
          return
        }

        const mainFetchOpts = {
          cache: true as const,
          globalTimeout: 22_000,
          eoseTimeout: 3500,
          firstRelayResultGraceMs: false as const
        }
        const chunkFetchOpts = {
          cache: true as const,
          globalTimeout: 12_000,
          eoseTimeout: 2200,
          firstRelayResultGraceMs: false as const
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
          mainFetchOpts
        )
        const chunkReqs = authorChunks.map((authors) =>
          client.fetchEvents(
            relayUrls,
            {
              kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
              authors,
              limit: FOLLOWING_CALENDAR_CHUNK_LIMIT
            },
            chunkFetchOpts
          )
        )

        const relayMergedP = Promise.all([mainReq, ...chunkReqs])
          .then((merged) => {
            const batch = merged[0] ?? []
            const fromFollowing: NostrEvent[] = []
            for (let i = 1; i < merged.length; i++) {
              fromFollowing.push(...(merged[i] ?? []))
            }
            return { batch, fromFollowing }
          })
          .catch(() => ({ batch: [] as NostrEvent[], fromFollowing: [] as NostrEvent[] }))

        const [{ batch, fromFollowing }, localBaseline] = await Promise.all([relayMergedP, idbP])
        if (cancelled) return

        const fromSession = client.getSessionEventsMatchingSearch(
          '',
          SESSION_CALENDAR_MERGE_CAP,
          [...CALENDAR_EVENT_KINDS]
        )
        setRawEvents(
          dedupeCalendarEventsPreferringOccurrenceRange(
            [...batch, ...fromFollowing, ...fromSession, ...localBaseline],
            rangeStartMs,
            rangeEndExclusiveMs
          )
        )
        lateMergeTimer = window.setTimeout(() => {
          lateMergeTimer = null
          if (cancelled) return
          const later = client.getSessionEventsMatchingSearch(
            '',
            SESSION_CALENDAR_MERGE_CAP,
            [...CALENDAR_EVENT_KINDS]
          )
          setRawEvents((prev) =>
            dedupeCalendarEventsPreferringOccurrenceRange(
              [...prev, ...later, ...localBaseline],
              rangeStartMs,
              rangeEndExclusiveMs
            )
          )
        }, 2500)
      } catch {
        if (!cancelled) {
          try {
            const rs = rangeStartMs
            const re = rangeEndExclusiveMs
            const [idb, arc] = await Promise.all([
              indexedDb.getCalendarEventsForOccurrenceWindow(rs, re, MONTH_IDB_MAX_SCAN),
              indexedDb.getArchivedCalendarEventsOverlappingWindow(rs, re, 55_000, 2500)
            ])
            const salvage = dedupeCalendarEventsPreferringOccurrenceRange([...idb, ...arc], rs, re)
            const fromSession = client.getSessionEventsMatchingSearch(
              '',
              SESSION_CALENDAR_MERGE_CAP,
              [...CALENDAR_EVENT_KINDS]
            )
            setRawEvents(dedupeCalendarEventsPreferringOccurrenceRange([...salvage, ...fromSession], rs, re))
          } catch {
            setRawEvents([])
          }
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      if (lateMergeTimer != null) window.clearTimeout(lateMergeTimer)
    }
  }, [relayKey, followAuthorsKey, paddedMonthRange, relayUrls.length, refreshKey])

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
    const base = new Date(2024, 0, 1)
    while (base.getDay() !== 1) base.setDate(base.getDate() + 1)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      return fmt.format(d)
    })
  }, [i18n.language])

  const monthTitle = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1)
    return new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(d)
  }, [viewYear, viewMonth, i18n.language])

  const gridCells = useMemo(() => {
    const offset = mondayFirstOffsetFromMonthStart(viewYear, viewMonth)
    const dim = daysInMonth(viewYear, viewMonth)
    const total = offset + dim
    const rows = Math.ceil(total / 7)
    const cells: { day: number | null; inMonth: boolean }[] = []
    for (let i = 0; i < rows * 7; i++) {
      const dayNum = i - offset + 1
      if (dayNum < 1 || dayNum > dim) cells.push({ day: null, inMonth: false })
      else cells.push({ day: dayNum, inMonth: true })
    }
    return cells
  }, [viewYear, viewMonth])

  const eventsForDay = useCallback(
    (day: number) => {
      const dayStart = new Date(viewYear, viewMonth, day, 0, 0, 0, 0).getTime()
      const dayEnd = dayStart + 86_400_000
      return rawEvents.filter((ev) => calendarOccurrenceOverlapsRange(ev, dayStart, dayEnd))
    },
    [rawEvents, viewYear, viewMonth]
  )

  const isDayInHighlightWeek = useCallback(
    (day: number) => {
      const dayStart = new Date(viewYear, viewMonth, day, 0, 0, 0, 0).getTime()
      const dayEnd = dayStart + 86_400_000
      return (
        dayStart < highlightBounds.weekEndExclusiveMs && dayEnd > highlightBounds.weekStartMs
      )
    },
    [viewYear, viewMonth, highlightBounds]
  )

  const openDayEventsPanel = useCallback(
    (day: number) => {
      const list = eventsForDay(day)
      const ymd = ymdForLocalDay(viewYear, viewMonth, day)
      setCalendarDayPanelEvents(ymd, list)
      push(`/calendar/day/${ymd}`)
    },
    [eventsForDay, viewYear, viewMonth, push]
  )

  const goPrevMonth = () => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }

  const goNextMonth = () => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }

  const jumpToThisWeek = () => {
    setActiveWeekOffset(0)
    const { weekStartMs } = getLocalMondayWeekBounds(0)
    const d = new Date(weekStartMs)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: () => setRefreshKey((k) => k + 1)
    }),
    []
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="calendar"
      titlebar={<CalendarPageTitlebar onRefresh={() => setRefreshKey((k) => k + 1)} />}
      displayScrollToTopButton
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 md:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="size-9" onClick={goPrevMonth} aria-label={t('calendarPagePrevMonth')}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="size-9" onClick={goNextMonth} aria-label={t('calendarPageNextMonth')}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h2 className="text-center text-lg font-semibold tracking-tight text-foreground md:text-xl">{monthTitle}</h2>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={jumpToThisWeek}>
            {t('calendarPageThisWeek')}
          </Button>
        </div>

        {loading && rawEvents.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">{t('sidebarCalendarLoading')}</p>
        ) : null}

        {useVerticalMonthCalendar ? (
          <div className="flex min-w-0 flex-col gap-1.5" aria-label={t('calendarPageGridLabel')}>
            {Array.from({ length: daysInMonth(viewYear, viewMonth) }, (_, idx) => {
              const day = idx + 1
              const list = eventsForDay(day)
              const inWeek = isDayInHighlightWeek(day)
              const weekdayShort = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
                new Date(viewYear, viewMonth, day, 12, 0, 0, 0)
              )
              const excess = list.length > 4 ? list.length - 4 : 0
              return (
                <div
                  key={`m-${viewYear}-${viewMonth}-${day}`}
                  className={cn(
                    'flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card p-2',
                    inWeek && 'bg-primary/10 ring-1 ring-inset ring-primary/35'
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-0.5">
                    <span className="text-[13px] font-semibold leading-tight text-foreground">
                      {weekdayShort} · {day}
                    </span>
                    {list.length > 0 ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t('calendarPageDayEventCount', { count: list.length })}
                      </span>
                    ) : null}
                  </div>
                  <ul className="min-w-0 space-y-0">
                    {list.slice(0, 4).map((ev) => {
                      const meta = getCalendarEventMeta(ev)
                      const title = meta.title?.trim() || t('calendarPageUntitledEvent')
                      return (
                        <li key={replaceableEventDedupeKey(ev)} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => navigateToNote(toNote(ev), ev)}
                            className={cn(
                              'flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium leading-snug text-primary',
                              'hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                            )}
                          >
                            <CalendarEventCoverImage
                              coverUrl={meta.image}
                              pubkey={ev.pubkey}
                              className="size-7 shrink-0 rounded-md ring-1 ring-border/50"
                              iconClassName="size-3.5"
                            />
                            <span className="min-w-0 truncate">{title}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {excess > 0 ? (
                    <button
                      type="button"
                      className="mt-0.5 w-full shrink-0 rounded-md py-1 text-center text-[11px] font-semibold text-primary underline-offset-2 hover:bg-muted/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t('calendarPageMoreEventsAria', { count: excess })}
                      onClick={() => openDayEventsPanel(day)}
                    >
                      +{excess}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div
            className="grid min-w-0 gap-px rounded-lg border border-border bg-border"
            style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
            role="grid"
            aria-label={t('calendarPageGridLabel')}
          >
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="bg-muted/80 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-xs"
                role="columnheader"
              >
                {label}
              </div>
            ))}
            {gridCells.map((cell, idx) => {
              if (cell.day == null) {
                return <div key={`pad-${idx}`} className="min-h-[72px] bg-muted/20 md:min-h-[96px]" />
              }
              const day = cell.day
              const list = eventsForDay(day)
              const inWeek = isDayInHighlightWeek(day)
              const excess = list.length > 4 ? list.length - 4 : 0
              return (
                <div
                  key={`${viewYear}-${viewMonth}-${day}`}
                  className={cn(
                    'flex min-h-[72px] min-w-0 flex-col gap-0.5 bg-card p-1 md:min-h-[96px] md:p-1.5',
                    inWeek && 'bg-primary/10 ring-1 ring-inset ring-primary/35'
                  )}
                  role="gridcell"
                >
                  <span className="text-[11px] font-semibold tabular-nums text-foreground md:text-xs">{day}</span>
                  <ul className="min-w-0 flex-1 space-y-0.5 overflow-hidden">
                    {list.slice(0, 4).map((ev) => {
                      const meta = getCalendarEventMeta(ev)
                      const title = meta.title?.trim() || t('calendarPageUntitledEvent')
                      return (
                        <li key={replaceableEventDedupeKey(ev)} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => navigateToNote(toNote(ev), ev)}
                            className={cn(
                              'flex w-full min-w-0 items-center gap-0.5 rounded px-0.5 py-px text-left text-[9px] font-medium leading-tight text-primary underline-offset-2',
                              'hover:bg-muted/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-[10px]'
                            )}
                            title={title}
                          >
                            <CalendarEventCoverImage
                              coverUrl={meta.image}
                              pubkey={ev.pubkey}
                              className="size-3.5 shrink-0 rounded-sm ring-1 ring-border/40 md:size-4"
                              iconClassName="size-2.5 md:size-3"
                            />
                            <span className="min-w-0 flex-1 truncate">{title}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {excess > 0 ? (
                    <button
                      type="button"
                      className="mt-0.5 w-full shrink-0 rounded py-0.5 text-center text-[9px] font-semibold text-primary underline-offset-2 hover:bg-muted/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-[10px]"
                      aria-label={t('calendarPageMoreEventsAria', { count: excess })}
                      onClick={() => openDayEventsPanel(day)}
                    >
                      +{excess}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PrimaryPageLayout>
  )
})

function CalendarPageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
      <div className="flex items-center gap-2 pl-3">
        <CalendarDays className="size-5 shrink-0" aria-hidden />
        <div className="app-chrome-title">{t('calendarPageTitle')}</div>
      </div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}

CalendarPrimaryPage.displayName = 'CalendarPrimaryPage'
export default CalendarPrimaryPage
