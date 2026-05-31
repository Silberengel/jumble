import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ExtendedKind } from '@/constants'
import { useMuteList } from '@/contexts/mute-list-context'
import { eventPassesNoteListKindPicker } from '@/lib/feed-kind-filter'
import { filterEventsExcludingMutedAuthors, muteSetHas } from '@/lib/mute-set'
import { filterEventsExcludingTombstones } from '@/lib/event'
import { extractHashtagsFromContent, formatTopicMapBubbleLabel, isValidNormalizedTopicKey, normalizeTopic } from '@/lib/discussion-topics'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { toNoteList } from '@/lib/link'
import logger from '@/lib/logger'
import { useSmartHashtagNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useNostr } from '@/providers/NostrProvider'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { cn } from '@/lib/utils'
import { SimpleUserAvatar } from '@/components/UserAvatar'
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
/** Max profile avatars shown around each topic bubble (by tag usage count). */
const MAX_BUBBLE_AVATARS = 7

export type TTopicKeywordBubble = {
  key: string
  score: number
  topicNoteCount: number
  keywordNoteCount: number
  pubkeys: string[]
}

type TopicKeyAccum = {
  topicNoteCount: number
  keywordNoteCount: number
  pubkeyHits: Map<string, number>
}

function topPubkeysForTopic(
  hits: Map<string, number>,
  limit: number,
  mutePubkeySet?: ReadonlySet<string>
): string[] {
  return [...hits.entries()]
    .filter(([pk]) => !mutePubkeySet || !muteSetHas(mutePubkeySet, pk))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([pk]) => pk)
}

function TopicBubbleAvatarRing({
  pubkeys,
  bubbleSizePx
}: {
  pubkeys: readonly string[]
  bubbleSizePx: number
}) {
  if (pubkeys.length === 0) return null
  const avatarPx = Math.max(16, Math.min(26, Math.round(bubbleSizePx * 0.15)))
  const orbitR = bubbleSizePx * (pubkeys.length === 1 ? 0 : 0.34)

  if (pubkeys.length === 1) {
    return (
      <div
        className="pointer-events-none overflow-hidden rounded-full ring-2 ring-primary/35"
        style={{ width: avatarPx * 1.35, height: avatarPx * 1.35 }}
        aria-hidden
      >
        <SimpleUserAvatar
          userId={pubkeys[0]!}
          deferRemoteAvatar
          maxFileSizeKb={400}
          className="!size-full max-w-none"
        />
      </div>
    )
  }

  return (
    <>
      {pubkeys.map((pk, i) => {
        const angle = (i / pubkeys.length) * Math.PI * 2 - Math.PI / 2
        const left = bubbleSizePx / 2 + orbitR * Math.cos(angle)
        const top = bubbleSizePx / 2 + orbitR * Math.sin(angle)
        return (
          <div
            key={pk}
            className="pointer-events-none absolute overflow-hidden rounded-full ring-2 ring-background"
            style={{
              width: avatarPx,
              height: avatarPx,
              left,
              top,
              transform: 'translate(-50%, -50%)'
            }}
            aria-hidden
          >
            <SimpleUserAvatar
              userId={pk}
              deferRemoteAvatar
              maxFileSizeKb={400}
              className="!size-full max-w-none"
            />
          </div>
        )
      })}
    </>
  )
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

export function buildTopicKeywordBubbles(
  events: Event[],
  showKinds: readonly number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean,
  mutePubkeySet?: ReadonlySet<string>
): TTopicKeywordBubble[] {
  const accum = new Map<string, TopicKeyAccum>()

  const bump = (key: string, ev: Event, viaTopicTag: boolean) => {
    if (!isValidNormalizedTopicKey(key)) return
    let row = accum.get(key)
    if (!row) {
      row = { topicNoteCount: 0, keywordNoteCount: 0, pubkeyHits: new Map() }
      accum.set(key, row)
    }
    if (viaTopicTag) row.topicNoteCount += 1
    else row.keywordNoteCount += 1
    const pk = ev.pubkey.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(pk)) {
      row.pubkeyHits.set(pk, (row.pubkeyHits.get(pk) ?? 0) + 1)
    }
  }

  for (const ev of events) {
    if (mutePubkeySet && muteSetHas(mutePubkeySet, ev.pubkey)) continue
    if (!eventPassesNoteListKindPicker(ev, showKinds, showKind1OPs, showKind1Replies, showKind1111)) continue
    const topics = new Set<string>()
    for (const row of ev.tags) {
      if (row[0] === 't' && row[1]) {
        const n = normalizeTopic(row[1])
        if (n && isValidNormalizedTopicKey(n)) topics.add(n)
      }
    }
    const kws = new Set(extractHashtagsFromContent(ev.content ?? ''))

    for (const k of topics) bump(k, ev, true)
    for (const k of kws) bump(k, ev, false)
  }

  const out: TTopicKeywordBubble[] = []
  for (const [key, row] of accum) {
    if (!isValidNormalizedTopicKey(key)) continue
    const score = row.topicNoteCount + row.keywordNoteCount
    if (score <= 0) continue
    out.push({
      key,
      score,
      topicNoteCount: row.topicNoteCount,
      keywordNoteCount: row.keywordNoteCount,
      pubkeys: topPubkeysForTopic(row.pubkeyHits, MAX_BUBBLE_AVATARS, mutePubkeySet)
    })
  }
  out.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
  return out.slice(0, MAX_BUBBLES)
}

type Props = {
  refreshKey: number
}

export default function TopicKeywordHeatMap({ refreshKey }: Props) {
  const { t } = useTranslation()
  const { mutePubkeySet } = useMuteList()
  const { navigateToHashtag } = useSmartHashtagNavigation()
  const { relayList, cacheRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilterOrDefaults()

  const relayUrls = useMemo(
    () =>
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadInboxUrls(relayList, cacheRelayListEvent),
        {
          userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent),
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

  const mergeData = useCallback(async (includeRelay = true): Promise<TTopicKeywordBubble[]> => {
    const windowStart = Math.floor(Date.now() / 1000) - HEAT_WINDOW_SEC
    const sessionEv = eventService.listSessionEventsByKinds(MAP_KINDS, { limit: SESSION_LIMIT })

    const archiveScan = indexedDb.scanEventArchiveByKinds({
      kinds: [...MAP_KINDS],
      since: windowStart,
      maxRowsScanned: ARCHIVE_MAX_SCAN,
      maxMatches: ARCHIVE_MAX_MATCHES
    })
    const relayFetch =
      includeRelay && relayUrls.length > 0
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
    const clean = filterEventsExcludingMutedAuthors(
      filterEventsExcludingTombstones([...dedup.values()], tombstones),
      mutePubkeySet
    )
    return buildTopicKeywordBubbles(clean, showKinds, showKind1OPs, showKind1Replies, showKind1111, mutePubkeySet)
  }, [relayUrls, showKinds, showKind1OPs, showKind1Replies, showKind1111, mutePubkeySet])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    setIsMerging(true)
    void (async () => {
      try {
        const localBubbles = await mergeData(false)
        if (cancelled) return
        setRows(localBubbles)
        setLoading(false)

        const bubbles = await mergeData(true)
        if (!cancelled) setRows(bubbles)
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

  useEffect(() => {
    const pubkeys = [...new Set(rows.flatMap((r) => r.pubkeys))].slice(0, 48)
    if (pubkeys.length === 0) return
    void Promise.allSettled(pubkeys.map((pk) => client.fetchProfileEvent(pk).catch(() => {})))
  }, [rows])

  const maxScore = useMemo(() => rows.reduce((m, r) => Math.max(m, r.score), 0) || 1, [rows])

  const openMergedFeed = useCallback(
    (key: string) => {
      navigateToHashtag(toNoteList({ hashtag: key }))
    },
    [navigateToHashtag]
  )

  const displayLabel = (key: string) => formatTopicMapBubbleLabel(key)

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
                      {row.pubkeys.length > 0 ? (
                        <TopicBubbleAvatarRing pubkeys={row.pubkeys} bubbleSizePx={size} />
                      ) : (
                        <span
                          className="rounded-full bg-primary/25 ring-2 ring-primary/35 transition-[width,height,opacity] group-hover:bg-primary/35"
                          style={{
                            width: `${22 + intensity * 48}%`,
                            height: `${22 + intensity * 48}%`,
                            opacity: 0.55 + intensity * 0.45
                          }}
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          'pointer-events-none absolute inset-x-1 bottom-1.5 z-[1] rounded-md px-1 py-0.5',
                          'text-pretty text-center text-[10px] font-semibold leading-tight text-foreground sm:text-xs',
                          'bg-background/75 backdrop-blur-[2px] shadow-sm'
                        )}
                      >
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
