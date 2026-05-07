import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ExtendedKind } from '@/constants'
import { eventPassesNoteListKindPicker } from '@/lib/feed-kind-filter'
import { filterEventsExcludingTombstones } from '@/lib/event'
import { extractHashtagsFromContent, normalizeTopic } from '@/lib/discussion-topics'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { toNoteList } from '@/lib/link'
import logger from '@/lib/logger'
import { useSmartHashtagNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useNostr } from '@/providers/NostrProvider'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { kinds, verifyEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HEAT_WINDOW_SEC = 30 * 24 * 3600
const HEAT_REQ_LIMIT = 1500
const MAX_BUBBLES = 10
const SESSION_LIMIT = 4000
const ARCHIVE_MAX_SCAN = 35_000
const ARCHIVE_MAX_MATCHES = 2500

const MAP_KINDS = [kinds.ShortTextNote, ExtendedKind.DISCUSSION] as const

const ARCHIVE_SCAN_TIMEOUT_MS = 22_000
const RELAY_FETCH_TIMEOUT_MS = 26_000
const TOMBSTONES_TIMEOUT_MS = 8_000

export type TTopicKeywordBubble = {
  key: string
  score: number
  topicNoteCount: number
  keywordNoteCount: number
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let settled = false
  return new Promise((resolve) => {
    const to = setTimeout(() => {
      if (settled) return
      settled = true
      logger.warn('[TopicKeywordHeatMap] timed out', { label, ms })
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
        logger.warn('[TopicKeywordHeatMap] source failed', { label, err: e })
        resolve(fallback)
      })
  })
}

function buildTopicKeywordBubbles(
  events: Event[],
  showKinds: readonly number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean
): TTopicKeywordBubble[] {
  const topicHits = new Map<string, number>()
  const kwHits = new Map<string, number>()

  for (const ev of events) {
    if (!eventPassesNoteListKindPicker(ev, showKinds, showKind1OPs, showKind1Replies, showKind1111)) continue
    const topics = new Set<string>()
    for (const row of ev.tags) {
      if (row[0] === 't' && row[1]) {
        const n = normalizeTopic(row[1])
        if (n) topics.add(n)
      }
    }
    const kws = new Set(extractHashtagsFromContent(ev.content ?? ''))

    for (const k of topics) {
      topicHits.set(k, (topicHits.get(k) ?? 0) + 1)
    }
    for (const k of kws) {
      kwHits.set(k, (kwHits.get(k) ?? 0) + 1)
    }
  }

  const keys = new Set<string>([...topicHits.keys(), ...kwHits.keys()])
  const out: TTopicKeywordBubble[] = []
  for (const key of keys) {
    const a = topicHits.get(key) ?? 0
    const b = kwHits.get(key) ?? 0
    const score = a + b
    if (score <= 0) continue
    out.push({ key, score, topicNoteCount: a, keywordNoteCount: b })
  }
  out.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
  return out.slice(0, MAX_BUBBLES)
}

type Props = {
  refreshKey: number
}

export default function TopicKeywordHeatMap({ refreshKey }: Props) {
  const { t } = useTranslation()
  const { navigateToHashtag } = useSmartHashtagNavigation()
  const { relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilterOrDefaults()

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

  const [rows, setRows] = useState<TTopicKeywordBubble[]>([])
  const [loading, setLoading] = useState(true)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescanTick, setRescanTick] = useState(0)

  const mergeData = useCallback(async (): Promise<TTopicKeywordBubble[]> => {
    const windowStart = Math.floor(Date.now() / 1000) - HEAT_WINDOW_SEC
    const sessionEv = eventService.listSessionEventsByKinds(MAP_KINDS, { limit: SESSION_LIMIT })

    const archiveScan = indexedDb.scanEventArchiveByKinds({
      kinds: [...MAP_KINDS],
      since: windowStart,
      maxRowsScanned: ARCHIVE_MAX_SCAN,
      maxMatches: ARCHIVE_MAX_MATCHES
    })
    const relayFetch =
      relayUrls.length > 0
        ? client.fetchEvents(
            relayUrls,
            { kinds: [...MAP_KINDS], limit: HEAT_REQ_LIMIT },
            { eoseTimeout: 8000, globalTimeout: 20000 }
          )
        : Promise.resolve([] as Event[])
    const tombstonesPromise = indexedDb.getAllTombstones()

    const [idbEv, relayRaw, tombstones] = await Promise.all([
      raceWithTimeout(archiveScan, ARCHIVE_SCAN_TIMEOUT_MS, [] as Event[], 'archive-scan'),
      raceWithTimeout(relayFetch, RELAY_FETCH_TIMEOUT_MS, [] as Event[], 'relay-fetch'),
      raceWithTimeout(tombstonesPromise, TOMBSTONES_TIMEOUT_MS, new Set<string>(), 'tombstones')
    ])

    const mergedById = new Map<string, Event>()
    for (const ev of [...sessionEv, ...idbEv, ...relayRaw]) {
      mergedById.set(ev.id.toLowerCase(), ev)
    }
    let merged = [...mergedById.values()].filter((e) => e.created_at >= windowStart)
    if (merged.length === 0 && mergedById.size > 0) {
      merged = [...mergedById.values()]
    }

    const dedup = new Map<string, Event>()
    for (const ev of merged) {
      if (!verifyEvent(ev)) continue
      dedup.set(ev.id.toLowerCase(), ev)
    }
    if (dedup.size === 0 && merged.length > 0) {
      for (const ev of merged) {
        if (!/^[0-9a-f]{64}$/i.test(ev.id) || !/^[0-9a-f]{64}$/i.test(ev.pubkey)) continue
        dedup.set(ev.id.toLowerCase(), ev)
      }
    }
    const clean = filterEventsExcludingTombstones([...dedup.values()], tombstones)
    return buildTopicKeywordBubbles(clean, showKinds, showKind1OPs, showKind1Replies, showKind1111)
  }, [relayUrls, showKinds, showKind1OPs, showKind1Replies, showKind1111])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    setIsMerging(true)
    void (async () => {
      try {
        const bubbles = await mergeData()
        if (!cancelled) {
          setRows(bubbles)
        }
      } catch (e) {
        if (!cancelled) {
          logger.warn('[TopicKeywordHeatMap] merge failed', { err: e })
          setError(t('topicMapFetchError'))
          setRows([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setIsMerging(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mergeData, refreshKey, rescanTick, t])

  const maxScore = useMemo(() => rows.reduce((m, r) => Math.max(m, r.score), 0) || 1, [rows])

  const openMergedFeed = useCallback(
    (key: string) => {
      const searchPhrase = key.replace(/-/g, ' ')
      navigateToHashtag(toNoteList({ hashtag: key, search: searchPhrase }))
    },
    [navigateToHashtag]
  )

  const displayLabel = (key: string) => `#${key.replace(/-/g, ' ')}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        {relayUrls.length === 0 ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            {t('topicMapLocalOnlyBanner')}
          </p>
        ) : null}
        <p>{t('topicMapDescription')}</p>
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
            {t('topicMapRescan')}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows.length === 0 && (loading || isMerging) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('topicMapLoading')}</p>
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-12 text-center text-sm text-muted-foreground">
          {t('topicMapEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
          <div className="relative flex w-full flex-wrap content-start items-start justify-center gap-4 pt-2">
            {rows.map((row) => {
              const intensity = Math.min(1, row.score / maxScore)
              const size = Math.min(200, Math.max(76, 52 + Math.sqrt(row.score) * 10))
              const countsLine = t('topicMapBubbleCounts', {
                topic: row.topicNoteCount,
                kw: row.keywordNoteCount
              })
              const ariaLabel = [displayLabel(row.key), countsLine, t('topicMapOpenMergedFeed')].join('. ')
              return (
                <HoverCard key={row.key} openDelay={160} closeDelay={80}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'group relative shrink-0 rounded-full border shadow-sm transition-transform',
                        'flex items-center justify-center px-2 text-center',
                        'hover:z-10 hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'border-border/70 bg-card/90 backdrop-blur-sm'
                      )}
                      style={{
                        width: size,
                        height: size,
                        boxShadow: `0 0 0 1px hsl(var(--border) / 0.35), inset 0 0 40px hsl(var(--primary) / ${0.06 + intensity * 0.28})`
                      }}
                      onClick={() => openMergedFeed(row.key)}
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
                      <span className="pointer-events-none absolute inset-2 flex items-center justify-center text-pretty text-xs font-semibold leading-tight text-foreground drop-shadow-sm sm:text-sm">
                        {displayLabel(row.key)}
                      </span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="top"
                    align="center"
                    className="w-72 max-w-[min(92vw,18rem)] border-border/80 p-3 text-sm shadow-lg"
                    collisionPadding={12}
                  >
                    <p className="font-medium text-foreground">{displayLabel(row.key)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{countsLine}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{t('topicMapClickHint')}</p>
                  </HoverCardContent>
                </HoverCard>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
