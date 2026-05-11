import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ExtendedKind } from '@/constants'
import { eventPassesNoteListKindPicker } from '@/lib/feed-kind-filter'
import { filterEventsExcludingTombstones } from '@/lib/event'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { toNote } from '@/lib/link'
import logger from '@/lib/logger'
import {
  parseRelayThreadHeatMapCache,
  relayThreadHeatMapSettingKey,
  serializeRelayThreadHeatMapCache
} from '@/lib/relay-thread-heat-cache'
import { orderHeatBubblesByKeywordProximity } from '@/lib/relay-thread-heat-keywords'
import {
  buildRelayThreadHeatBubbles,
  buildRelayThreadHeatEdges,
  collapseRelayThreadHeatSnippet,
  RELAY_THREAD_HEAT_MIN_INTERACTIONS,
  type TRelayThreadHeatBubble,
  type TRelayThreadHeatEdge
} from '@/lib/relay-thread-heat'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSmartNoteNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useNostr } from '@/providers/NostrProvider'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { kinds, verifyEvent } from 'nostr-tools'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HEAT_WINDOW_SEC = 72 * 3600
/** REQ without `since`: many relays return nothing for kind 1+`since`; we clip by `created_at` client-side. */
const HEAT_REQ_LIMIT = 1500
const MAX_BUBBLES = 10
const SESSION_HEAT_LIMIT = 2500
/** Cap rows scanned so the heat map stays responsive on large archives. */
const ARCHIVE_HEAT_MAX_SCAN = 30_000
const ARCHIVE_HEAT_MAX_MATCHES = 2000

function mergeEventsById(events: Event[]): Event[] {
  const eventsById = new Map<string, Event>()
  for (const event of events) {
    if (!event?.id) continue
    const existing = eventsById.get(event.id)
    if (!existing || event.created_at > existing.created_at) {
      eventsById.set(event.id, event)
    }
  }
  return Array.from(eventsById.values())
}

const HEAT_KINDS = [kinds.ShortTextNote, ExtendedKind.DISCUSSION] as const

const ARCHIVE_SCAN_TIMEOUT_MS = 22_000
const RELAY_FETCH_TIMEOUT_MS = 28_000
/** Load thread roots that sit outside the heat time window so hover text is the OP, not a reply. */
const ROOT_SNIPPET_FETCH_TIMEOUT_MS = 12_000
const TOMBSTONES_TIMEOUT_MS = 8_000

function raceWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let settled = false
  return new Promise((resolve) => {
    const to = setTimeout(() => {
      if (settled) return
      settled = true
      logger.warn('[RelayThreadHeatMap] timed out', { label, ms })
      resolve(fallback)
    }, ms)
    promise
      .then((v) => {
        if (settled) return
        settled = true
        clearTimeout(to)
        resolve(v)
      })
      .catch((e) => {
        if (settled) return
        settled = true
        clearTimeout(to)
        logger.warn('[RelayThreadHeatMap] source failed', { label, err: e })
        resolve(fallback)
      })
  })
}

type Props = {
  followPubkeys: string[]
  refreshKey: number
}

export default function RelayThreadHeatMap({ followPubkeys, refreshKey }: Props) {
  const { t } = useTranslation()
  const { navigate: navigatePrimary } = usePrimaryPage()
  const { navigateToNote } = useSmartNoteNavigation()
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilterOrDefaults()

  const feedFilterKey = useMemo(
    () =>
      [
        [...showKinds].sort((a, b) => a - b).join(','),
        showKind1OPs ? '1' : '0',
        showKind1Replies ? '1' : '0',
        showKind1111 ? '1' : '0'
      ].join('|'),
    [showKinds, showKind1OPs, showKind1Replies, showKind1111]
  )

  const followSet = useMemo(
    () => new Set(followPubkeys.map((p) => p.trim().toLowerCase()).filter(Boolean)),
    [followPubkeys]
  )

  const relayUrls = useMemo(
    () =>
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadRelaysWithHttp(relayList),
        {
          userWriteRelays: relayList?.write ?? [],
          applySocialKindBlockedFilter: false
        }
      ),
    [favoriteRelays, blockedRelays, relayList]
  )

  const [rows, setRows] = useState<TRelayThreadHeatBubble[]>([])
  const [edges, setEdges] = useState<TRelayThreadHeatEdge[]>([])
  /** True until the first cache read + merge attempt finishes for this mount/context. */
  const [loading, setLoading] = useState(true)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescanTick, setRescanTick] = useState(0)

  const cacheSettingKey = useMemo(
    () => (pubkey ? relayThreadHeatMapSettingKey(pubkey, relayUrls, followPubkeys, feedFilterKey) : ''),
    [pubkey, relayUrls, followPubkeys, feedFilterKey]
  )

  const mergeHeatMapData = useCallback(async (): Promise<{
    bubbles: TRelayThreadHeatBubble[]
    edges: TRelayThreadHeatEdge[]
  }> => {
    const windowStart = Math.floor(Date.now() / 1000) - HEAT_WINDOW_SEC
    const sessionEv = eventService.listSessionEventsByKinds(HEAT_KINDS, { limit: SESSION_HEAT_LIMIT })

    logger.info('[RelayThreadHeatMap] merge started', {
      relayCount: relayUrls.length,
      sessionEvents: sessionEv.length
    })

    const archiveScan = indexedDb.scanEventArchiveByKinds({
      kinds: HEAT_KINDS,
      since: windowStart,
      maxRowsScanned: ARCHIVE_HEAT_MAX_SCAN,
      maxMatches: ARCHIVE_HEAT_MAX_MATCHES
    })
    const relayFetch =
      relayUrls.length > 0
        ? client.fetchEvents(
            relayUrls,
            { kinds: [...HEAT_KINDS], limit: HEAT_REQ_LIMIT },
            { eoseTimeout: 8000, globalTimeout: 22000 }
          )
        : Promise.resolve([] as Event[])
    const tombstonesPromise = indexedDb.getAllTombstones()

    const [idbEv, relayRaw, tombstones] = await Promise.all([
      raceWithTimeout(archiveScan, ARCHIVE_SCAN_TIMEOUT_MS, [] as Event[], 'archive-scan'),
      raceWithTimeout(relayFetch, RELAY_FETCH_TIMEOUT_MS, [] as Event[], 'relay-fetch'),
      raceWithTimeout(tombstonesPromise, TOMBSTONES_TIMEOUT_MS, new Set<string>(), 'tombstones')
    ])

    logger.info('[RelayThreadHeatMap] merge sources ready', {
      idb: idbEv.length,
      relay: relayRaw.length,
      tombstones: tombstones.size
    })

    const mergedById = mergeEventsById([...sessionEv, ...idbEv, ...relayRaw])
    let timeFiltered = mergedById.filter((e) => e.created_at >= windowStart)
    if (timeFiltered.length === 0 && mergedById.length > 0) {
      timeFiltered = mergedById
    }

    const dedup = new Map<string, Event>()
    for (const ev of timeFiltered) {
      if (!verifyEvent(ev)) continue
      dedup.set(ev.id.toLowerCase(), ev)
    }
    if (dedup.size === 0 && timeFiltered.length > 0) {
      for (const ev of timeFiltered) {
        if (!/^[0-9a-f]{64}$/i.test(ev.id) || !/^[0-9a-f]{64}$/i.test(ev.pubkey)) continue
        dedup.set(ev.id.toLowerCase(), ev)
      }
    }
    const merged = filterEventsExcludingTombstones([...dedup.values()], tombstones)
    const feedNotes = merged.filter((e) =>
      eventPassesNoteListKindPicker(e, showKinds, showKind1OPs, showKind1Replies, showKind1111)
    )
    const ranked = buildRelayThreadHeatBubbles(feedNotes, followSet, windowStart)
    let bubbles = ranked
      .filter((b) => b.postCount >= RELAY_THREAD_HEAT_MIN_INTERACTIONS)
      .slice(0, MAX_BUBBLES)

    const missingRootIds = [
      ...new Set(
        bubbles
          .filter((b) => !b.rootEvent)
          .map((b) => b.rootId.trim().toLowerCase())
          .filter((id) => /^[0-9a-f]{64}$/.test(id))
      )
    ]
    if (missingRootIds.length > 0) {
      const rootById = new Map<string, Event>()
      const archived = await indexedDb.getArchivedEventsByIds(missingRootIds)
      for (const ev of archived) {
        if (!verifyEvent(ev)) continue
        if (ev.kind !== kinds.ShortTextNote && ev.kind !== ExtendedKind.DISCUSSION) continue
        rootById.set(ev.id.toLowerCase(), ev)
      }
      const stillMissing = missingRootIds.filter((id) => !rootById.has(id))
      if (stillMissing.length > 0 && relayUrls.length > 0) {
        const fetched = await raceWithTimeout(
          client.fetchEvents(
            relayUrls,
            { ids: stillMissing, kinds: [...HEAT_KINDS] },
            { eoseTimeout: 6000, globalTimeout: ROOT_SNIPPET_FETCH_TIMEOUT_MS }
          ),
          ROOT_SNIPPET_FETCH_TIMEOUT_MS,
          [] as Event[],
          'heat-map-root-snippet'
        )
        for (const ev of fetched) {
          if (!verifyEvent(ev)) continue
          if (ev.kind !== kinds.ShortTextNote && ev.kind !== ExtendedKind.DISCUSSION) continue
          rootById.set(ev.id.toLowerCase(), ev)
        }
      }
      if (rootById.size > 0) {
        bubbles = bubbles.map((b) => {
          if (b.rootEvent) return b
          const ev = rootById.get(b.rootId.toLowerCase())
          if (!ev) return b
          return {
            ...b,
            rootEvent: ev,
            snippet: collapseRelayThreadHeatSnippet(ev.content?.trim() ?? '')
          }
        })
      }
    }

    const roots = new Set(bubbles.map((b) => b.rootId))
    const edges = buildRelayThreadHeatEdges(feedNotes, roots)
    logger.info('[RelayThreadHeatMap] merge finished', {
      bubbles: bubbles.length,
      merged: merged.length,
      afterFeedFilter: feedNotes.length,
      edges: edges.length
    })
    return { bubbles, edges }
  }, [relayUrls, followSet, showKinds, showKind1OPs, showKind1Replies, showKind1111])

  useEffect(() => {
    let cancelled = false
    if (!pubkey || !cacheSettingKey) {
      setRows([])
      setEdges([])
      setLoading(false)
      setIsMerging(false)
      setError(null)
      return
    }

    void (async () => {
      setError(null)
      let hadEnvelope = false

      const raw = await indexedDb.getSetting(cacheSettingKey)
      if (cancelled) return
      const cached = parseRelayThreadHeatMapCache(raw)
      if (cached) {
        hadEnvelope = true
        setRows(cached.bubbles)
        setEdges(cached.edges ?? [])
        setLoading(false)
      } else {
        setLoading(true)
      }

      setIsMerging(true)
      try {
        const { bubbles, edges: nextEdges } = await mergeHeatMapData()
        if (cancelled) return
        setRows(bubbles)
        setEdges(nextEdges)
        setError(null)
        try {
          await indexedDb.setSetting(
            cacheSettingKey,
            serializeRelayThreadHeatMapCache({
              v: 1,
              builtAtMs: Date.now(),
              bubbles,
              edges: nextEdges
            })
          )
        } catch (persistErr) {
          logger.warn('[RelayThreadHeatMap] cache persist failed', persistErr)
        }
      } catch (e) {
        if (cancelled) return
        logger.warn('[RelayThreadHeatMap] fetch failed', e)
        setError(t('heatMapFetchError'))
        if (!hadEnvelope) {
          setRows([])
          setEdges([])
        }
      } finally {
        if (!cancelled) {
          setIsMerging(false)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pubkey, cacheSettingKey, mergeHeatMapData, refreshKey, rescanTick, t])

  /** Pack threads that share a keyword next to each other in the flex grid (see {@link orderHeatBubblesByKeywordProximity}). */
  const layoutRows = useMemo(() => orderHeatBubblesByKeywordProximity(rows), [rows])

  const maxHeat = useMemo(() => layoutRows.reduce((m, r) => Math.max(m, r.heat), 0) || 1, [layoutRows])

  const graphAreaRef = useRef<HTMLDivElement>(null)
  const bubbleRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  type ConnectorSeg = {
    x1: number
    y1: number
    x2: number
    y2: number
    threadA: string
    threadB: string
  }
  const [lineSegs, setLineSegs] = useState<ConnectorSeg[]>([])
  const [hoveredConnector, setHoveredConnector] = useState<{ a: string; b: string } | null>(null)

  const rowByRoot = useMemo(() => new Map(layoutRows.map((r) => [r.rootId, r])), [layoutRows])

  const bindBubbleRef = useCallback((rootId: string) => (el: HTMLButtonElement | null) => {
    if (el) bubbleRefs.current.set(rootId, el)
    else bubbleRefs.current.delete(rootId)
  }, [])

  const connectorTitle = useCallback(
    (threadA: string, threadB: string) => {
      const clip = (s: string, max: number) => {
        const x = s.replace(/\s+/g, ' ').trim()
        return x.length <= max ? x : `${x.slice(0, max - 1)}…`
      }
      const left = clip(rowByRoot.get(threadA)?.snippet ?? threadA, 96)
      const right = clip(rowByRoot.get(threadB)?.snippet ?? threadB, 96)
      return t('heatMapConnectorHint', { left, right })
    },
    [rowByRoot, t]
  )

  const recomputeConnectorLines = useCallback(() => {
    const host = graphAreaRef.current
    if (!host || layoutRows.length === 0) {
      setLineSegs([])
      return
    }
    const br = host.getBoundingClientRect()
    const centerOf = (rootId: string) => {
      const el = bubbleRefs.current.get(rootId)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2 }
    }
    const segs: ConnectorSeg[] = []
    for (const { a, b } of edges) {
      const ca = centerOf(a)
      const cb = centerOf(b)
      if (ca && cb) {
        segs.push({ x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y, threadA: a, threadB: b })
      }
    }
    setLineSegs(segs)
  }, [layoutRows, edges])

  useLayoutEffect(() => {
    recomputeConnectorLines()
  }, [recomputeConnectorLines])

  useEffect(() => {
    const host = graphAreaRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => recomputeConnectorLines())
    })
    ro.observe(host)
    for (const row of layoutRows) {
      const el = bubbleRefs.current.get(row.rootId)
      if (el) ro.observe(el)
    }
    return () => ro.disconnect()
  }, [layoutRows, edges, recomputeConnectorLines])

  if (!pubkey) {
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        {relayUrls.length === 0 ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            {t('heatMapLocalOnlyBanner')}
          </p>
        ) : null}
        <p>{t('heatMapDescription')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isMerging && rows.length === 0}
            onClick={() => setRescanTick((n) => n + 1)}
          >
            {isMerging ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {t('heatMapRescan')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => navigatePrimary('spells', { spell: 'topicMap' })}
          >
            {t('Topic map')}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows.length === 0 && (loading || isMerging) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('heatMapLoading')}</p>
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-12 text-center text-sm text-muted-foreground">
          {t('heatMapEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
          <div ref={graphAreaRef} className="relative w-full min-h-[min(40vh,420px)] pt-2">
            <svg
              className="absolute inset-0 z-[1] h-full w-full overflow-visible text-primary"
              role="presentation"
            >
              <g className="pointer-events-none">
                {lineSegs.map((s, i) => {
                  const hi =
                    hoveredConnector != null &&
                    ((hoveredConnector.a === s.threadA && hoveredConnector.b === s.threadB) ||
                      (hoveredConnector.a === s.threadB && hoveredConnector.b === s.threadA))
                  return (
                    <line
                      key={`vis-${s.threadA}-${s.threadB}-${i}`}
                      x1={s.x1}
                      y1={s.y1}
                      x2={s.x2}
                      y2={s.y2}
                      stroke="currentColor"
                      strokeOpacity={hi ? 0.82 : 0.38}
                      strokeWidth={hi ? 2.35 : 1.75}
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              </g>
              <g>
                {lineSegs.map((s, i) => {
                  const title = connectorTitle(s.threadA, s.threadB)
                  return (
                    <g key={`hit-${s.threadA}-${s.threadB}-${i}`}>
                      <title>{title}</title>
                      <line
                        x1={s.x1}
                        y1={s.y1}
                        x2={s.x2}
                        y2={s.y2}
                        stroke="transparent"
                        strokeWidth={14}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        className="cursor-help"
                        style={{ pointerEvents: 'stroke' }}
                        onMouseEnter={() => setHoveredConnector({ a: s.threadA, b: s.threadB })}
                        onMouseLeave={() => setHoveredConnector(null)}
                      />
                    </g>
                  )
                })}
              </g>
            </svg>
            <div className="pointer-events-none relative z-10 flex flex-wrap content-start items-start justify-center gap-4">
              {layoutRows.map((row) => {
                const intensity = Math.min(1, row.heat / maxHeat)
                const size = Math.min(200, Math.max(76, 52 + Math.sqrt(row.heat) * 9))
                const statsLine = t('heatMapBubbleStats', {
                  posts: row.postCount,
                  people: row.uniqueAuthors,
                  follows: row.followAuthorsInThread
                })
                const ariaLabel = [row.snippet, statsLine, t('heatMapOpenThread')].filter(Boolean).join('. ')
                const connectorHit =
                  hoveredConnector != null &&
                  (row.rootId === hoveredConnector.a || row.rootId === hoveredConnector.b)
                return (
                  <HoverCard key={row.rootId} openDelay={180} closeDelay={80}>
                    <HoverCardTrigger asChild>
                      <button
                        ref={bindBubbleRef(row.rootId)}
                        type="button"
                        className={cn(
                          'pointer-events-auto group relative shrink-0 rounded-full border shadow-sm transition-transform',
                          'flex items-center justify-center',
                          'hover:z-10 hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          'border-border/70 bg-card/90 backdrop-blur-sm',
                          connectorHit && 'z-[9] scale-[1.03] ring-2 ring-primary/70 ring-offset-2 ring-offset-background'
                        )}
                        style={{
                          width: size,
                          height: size,
                          boxShadow: `0 0 0 1px hsl(var(--border) / 0.35), inset 0 0 40px hsl(var(--primary) / ${0.06 + intensity * 0.28})`
                        }}
                        onClick={() => navigateToNote(toNote(row.rootId), row.rootEvent)}
                        aria-label={ariaLabel}
                      >
                        <span
                          className="rounded-full bg-primary/25 ring-2 ring-primary/35 transition-[width,height,opacity] group-hover:bg-primary/35"
                          style={{
                            width: `${22 + intensity * 48}%`,
                            height: `${22 + intensity * 48}%`,
                            opacity: 0.55 + intensity * 0.45
                          }}
                          aria-hidden
                        />
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="top"
                      align="center"
                      className="w-80 max-w-[min(92vw,22rem)] border-border/80 p-0 shadow-lg"
                      collisionPadding={12}
                    >
                      <div className="max-h-56 overflow-y-auto px-3 py-2.5 text-left">
                        <p className="whitespace-pre-wrap text-sm leading-snug text-foreground">{row.snippet}</p>
                        <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">{statsLine}</p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
