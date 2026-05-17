import NoteCard from '@/components/NoteCard'
import RelayIcon from '@/components/RelayIcon'
import { Skeleton } from '@/components/ui/skeleton'
import { toRelay } from '@/lib/link'
import { compareMergedNip50SearchHits } from '@/lib/dtag-search'
import { mergedSearchNoteHasPreviewBody } from '@/lib/merged-search-note-preview'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { normalizeUrl } from '@/lib/url'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import client from '@/services/client.service'
import { NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS } from '@/services/client-query.service'
import relayInfoService from '@/services/relay-info.service'
import { relayHostForSubscribeLog } from '@/services/relay-operation-log.service'
import type { TProfile, TRelayInfo } from '@/types'
import type { Event, Filter } from 'nostr-tools'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'
import { buildAlexandriaEventsSearchUrlFromNotesQuery } from '@/lib/alexandria-events-search-url'
import { HardDrive, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartRelayNavigationOptional } from '@/PageManager'

type MergedHit = {
  event: Event
  relayUrls: string[]
  /** Matched publication cache / event archive on this device (not relay NIP-50). */
  fromLocalArchive?: boolean
}

/**
 * Hard cap for the merged search wave (abort signal), from the first relay query start.
 * Must exceed {@link NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS} so at least one slow index relay can EOSE.
 */
const SEARCH_TOTAL_WALL_MS = NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS + 18_000
/** After the first results arrive from any relay, end the wave this many ms later (capped by {@link SEARCH_TOTAL_WALL_MS}). */
const SEARCH_AFTER_FIRST_RELAY_MS = 6_000
/** Per-relay {@link QueryService.query} budget (capped by remaining wave wall). Align with NIP-50 index latency. */
const SEARCH_PER_RELAY_QUERY_MS = NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS
/** Avoid opening every index relay at once (pool + main thread). */
const FULL_TEXT_SEARCH_RELAY_CONCURRENCY = 3
const FULL_TEXT_SEARCH_PER_RELAY_LIMIT = 80
/** Per-relay cap before merge (limits duplicate work). */
const FULL_TEXT_SEARCH_MAX_NOTES_PER_RELAY = 40
/** Max merged unique notes shown after deduping across relays. */
const FULL_TEXT_SEARCH_MAX_MERGED_EVENTS = 150
/** Batched kind-0 fetch chunk size (aligned with feed profile batching). */
const SEARCH_MERGED_PROFILE_CHUNK = 80
/** Coalesce rapid merge updates before hitting the network. */
const SEARCH_MERGED_PROFILE_DEBOUNCE_MS = 240

function extractMergedHitAuthorPubkeys(hits: MergedHit[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    const pk = h.event.pubkey?.trim().toLowerCase()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk) || seen.has(pk)) continue
    seen.add(pk)
    out.push(pk)
  }
  return out
}

/**
 * Feed-style batched profile hydration so merged NIP-50 cards do not each run a separate
 * {@link useFetchProfile} network path (main-thread + pool pressure).
 */
function SearchMergedProfileProvider({
  resetKey,
  mergedHits,
  children
}: {
  resetKey: string
  mergedHits: MergedHit[]
  children: ReactNode
}) {
  const [batch, setBatch] = useState(() => ({
    profiles: new Map<string, TProfile>(),
    pending: new Set<string>(),
    version: 0
  }))
  const mergedHitsRef = useRef(mergedHits)
  mergedHitsRef.current = mergedHits
  const fetchAttemptedRef = useRef(new Set<string>())

  useEffect(() => {
    fetchAttemptedRef.current = new Set()
    setBatch({ profiles: new Map(), pending: new Set(), version: 0 })
  }, [resetKey])

  const hitsIdentity = useMemo(
    () =>
      [...mergedHits]
        .map((h) => h.event.id)
        .sort()
        .join('\x1e'),
    [mergedHits]
  )

  useEffect(() => {
    if (!hitsIdentity) return
    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      const hits = mergedHitsRef.current
      const pubkeys = extractMergedHitAuthorPubkeys(hits)
      if (pubkeys.length === 0) return

      const need = pubkeys.filter((pk) => !fetchAttemptedRef.current.has(pk))
      if (need.length === 0) return
      for (const pk of need) {
        fetchAttemptedRef.current.add(pk)
      }

      setBatch((prev) => {
        const pending = new Set(prev.pending)
        let changed = false
        for (const pk of need) {
          if (!prev.profiles.has(pk)) {
            pending.add(pk)
            changed = true
          }
        }
        if (!changed) return prev
        return { ...prev, pending }
      })

      void (async () => {
        const chunks: string[][] = []
        for (let i = 0; i < need.length; i += SEARCH_MERGED_PROFILE_CHUNK) {
          chunks.push(need.slice(i, i + SEARCH_MERGED_PROFILE_CHUNK))
        }
        for (const chunk of chunks) {
          if (cancelled) return
          let profiles: TProfile[] = []
          try {
            profiles = await client.fetchProfilesForPubkeys(chunk)
          } catch {
            profiles = []
          }
          if (cancelled) return
          setBatch((prev) => {
            const next = new Map(prev.profiles)
            const pend = new Set(prev.pending)
            for (const p of profiles) {
              const pkNorm = p.pubkey.toLowerCase()
              next.set(pkNorm, { ...p, pubkey: pkNorm })
              pend.delete(pkNorm)
            }
            for (const pk of chunk) {
              const pkNorm = pk.toLowerCase()
              pend.delete(pkNorm)
              if (!next.has(pkNorm)) {
                next.set(pkNorm, {
                  pubkey: pkNorm,
                  npub: pubkeyToNpub(pkNorm) ?? '',
                  username: formatPubkey(pkNorm),
                  batchPlaceholder: true
                })
              }
            }
            return { profiles: next, pending: pend, version: prev.version + 1 }
          })
        }
      })()
    }, SEARCH_MERGED_PROFILE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [hitsIdentity, resetKey])

  const ctxVal = useMemo<NoteFeedProfileContextValue>(
    () => ({
      profiles: batch.profiles,
      pendingPubkeys: batch.pending,
      version: batch.version
    }),
    [batch.profiles, batch.pending, batch.version]
  )

  return <NoteFeedProfileContext.Provider value={ctxVal}>{children}</NoteFeedProfileContext.Provider>
}

/** Max events to push into session cache per animation frame (keeps the tab responsive during merges). */
const ADD_TO_CACHE_PER_FRAME = 8

async function addSearchEventsToSessionCacheBatched(
  events: Event[],
  runGeneration: { current: number },
  myRun: number
): Promise<void> {
  for (let i = 0; i < events.length; i += ADD_TO_CACHE_PER_FRAME) {
    if (myRun !== runGeneration.current) return
    const slice = events.slice(i, i + ADD_TO_CACHE_PER_FRAME)
    for (const e of slice) {
      client.addEventToCache(e, { explicitNoteLookupHexId: e.id })
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

type SearchSourcePhase = 'loading' | 'done' | 'error'

type LocalSearchRow = {
  phase: SearchSourcePhase
  /** Notes that pass the preview filter (shown in results). */
  hitCount: number
  /** Raw matches before preview filter. */
  rawCount: number
  ms?: number
  errorMessage?: string
}

type RelayFetchRow = {
  relayUrl: string
  host: string
  phase: SearchSourcePhase
  /** Preview-visible hits merged into results. */
  eventCount?: number
  /** Events returned by the relay before preview filter. */
  rawEventCount?: number
  ms?: number
  errorMessage?: string
}

function formatSourceStatusLabel(
  row: {
    phase: SearchSourcePhase
    hitCount: number
    rawCount?: number
    errorMessage?: string
  },
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (row.phase === 'loading') {
    return t('Full-text search source loading')
  }
  if (row.phase === 'error') {
    const msg = row.errorMessage?.trim()
    return msg && msg.length <= 120 ? msg : t('Full-text search relay error')
  }
  const shown = row.hitCount
  const raw = row.rawCount ?? shown
  if (shown === 0 && raw === 0) {
    if (row.errorMessage?.trim()) {
      return t('Full-text search source zero with note', { note: row.errorMessage.trim() })
    }
    return t('Full-text search source zero hits')
  }
  if (raw > shown) {
    return t('Full-text search source hits with raw', { shown, raw })
  }
  return t('Full-text search source hits', { count: shown })
}

function SearchSourceProgressList({
  localRow,
  relayRows,
  relayInfoByKey,
  anyLoading
}: {
  localRow: LocalSearchRow | null
  relayRows: RelayFetchRow[]
  relayInfoByKey: Record<string, TRelayInfo | undefined>
  anyLoading: boolean
}) {
  const { t } = useTranslation()

  if (!localRow && relayRows.length === 0) return null

  return (
    <section
      className="rounded-lg border border-border/60 bg-muted/20 text-xs"
      aria-label={t('Full-text search sources progress')}
      aria-busy={anyLoading}
    >
      <ul className="divide-y divide-border/50">
        {localRow ? (
          <li className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 shrink-0 font-medium text-foreground">
              {t('Full-text search source local')}
            </span>
            <span
              className={cn(
                'ml-auto min-w-0 text-right',
                localRow.phase === 'error'
                  ? 'text-destructive'
                  : localRow.phase === 'loading'
                    ? 'text-muted-foreground'
                    : localRow.hitCount > 0
                      ? 'text-foreground'
                      : 'text-muted-foreground'
              )}
            >
              {formatSourceStatusLabel(
                {
                  phase: localRow.phase,
                  hitCount: localRow.hitCount,
                  rawCount: localRow.rawCount,
                  errorMessage: localRow.errorMessage
                },
                t
              )}
              {localRow.ms != null && localRow.phase !== 'loading' ? (
                <span className="text-muted-foreground"> · {localRow.ms} ms</span>
              ) : null}
            </span>
            {localRow.phase === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </li>
        ) : null}
        {relayRows.map((row) => (
          <li key={row.relayUrl} className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <RelayIcon
              url={row.relayUrl}
              className="h-4 w-4 shrink-0 rounded-sm"
              iconSize={10}
              relayInfo={relayInfoByKey[relayKey(row.relayUrl)]}
              skipRelayInfoFetch
            />
            <span className="min-w-0 truncate font-mono text-foreground" title={row.relayUrl}>
              {row.host}
            </span>
            <span
              className={cn(
                'ml-auto min-w-0 max-w-[55%] text-right leading-snug',
                row.phase === 'error'
                  ? 'text-destructive'
                  : row.phase === 'loading'
                    ? 'text-muted-foreground'
                    : (row.eventCount ?? 0) > 0
                      ? 'text-foreground'
                      : 'text-muted-foreground'
              )}
            >
              {formatSourceStatusLabel(
                {
                  phase: row.phase,
                  hitCount: row.eventCount ?? 0,
                  rawCount: row.rawEventCount,
                  errorMessage: row.errorMessage
                },
                t
              )}
              {row.ms != null && row.phase !== 'loading' ? (
                <span className="text-muted-foreground"> · {row.ms} ms</span>
              ) : null}
            </span>
            {row.phase === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Dedupe while preserving {@link SEARCHABLE_RELAY_URLS} priority (fast index relays first). */
function normalizeRelayList(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const n = normalizeUrl(raw) || raw.trim()
    if (!n) continue
    const k = relayKey(n)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

function relayKey(url: string): string {
  return (normalizeUrl(url) || url.trim()).toLowerCase()
}

function sortRelaysByHost(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean) as string[])).sort((a, b) =>
    relayHostForSubscribeLog(a).localeCompare(relayHostForSubscribeLog(b))
  )
}

export default function FullTextSearchByRelay({
  searchQuery,
  relayUrls,
  kinds,
  alexandriaEmptyHref: alexandriaEmptyHrefProp = null
}: {
  searchQuery: string
  relayUrls: readonly string[]
  kinds: readonly number[]
  alexandriaEmptyHref?: string | null
}) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigationOptional() ?? {
    navigateToRelay: (url: string) => {
      window.location.href = url
    }
  }
  const runGeneration = useRef(0)
  const [localSearchRow, setLocalSearchRow] = useState<LocalSearchRow | null>(null)
  const [relayRows, setRelayRows] = useState<RelayFetchRow[]>([])
  const [mergedHits, setMergedHits] = useState<MergedHit[]>([])
  const [relayInfoByKey, setRelayInfoByKey] = useState<Record<string, TRelayInfo | undefined>>({})

  const normalizedRelays = useMemo(() => normalizeRelayList(relayUrls), [relayUrls])

  const q = searchQuery.trim()
  const alexandriaEmptyHref = useMemo(() => {
    if (alexandriaEmptyHrefProp) return alexandriaEmptyHrefProp
    return q ? buildAlexandriaEventsSearchUrlFromNotesQuery(q) : null
  }, [alexandriaEmptyHrefProp, q])
  const searchProfileResetKey = useMemo(
    () => `${q}\n${normalizedRelays.join('\n')}`,
    [q, normalizedRelays]
  )

  const relayUrlsForIconPrefetch = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const push = (url: string) => {
      const k = relayKey(url)
      if (!k || seen.has(k)) return
      seen.add(k)
      out.push(url)
    }
    for (const u of normalizedRelays) push(u)
    for (const hit of mergedHits) {
      for (const u of hit.relayUrls) push(u)
    }
    return out
  }, [normalizedRelays, mergedHits])

  useEffect(() => {
    if (relayUrlsForIconPrefetch.length === 0) {
      setRelayInfoByKey({})
      return
    }
    let cancelled = false
    void relayInfoService.getRelayInfos(relayUrlsForIconPrefetch).then((infos) => {
      if (cancelled) return
      const next: Record<string, TRelayInfo | undefined> = {}
      relayUrlsForIconPrefetch.forEach((url, i) => {
        const info = infos[i]
        if (info) next[relayKey(url)] = info
      })
      setRelayInfoByKey((prev) => ({ ...prev, ...next }))
    })
    return () => {
      cancelled = true
    }
  }, [relayUrlsForIconPrefetch])

  const anyLoading =
    localSearchRow?.phase === 'loading' || relayRows.some((r) => r.phase === 'loading')
  const allTerminal =
    localSearchRow != null &&
    localSearchRow.phase !== 'loading' &&
    relayRows.length > 0 &&
    relayRows.every((r) => r.phase === 'done' || r.phase === 'error')

  useEffect(() => {
    /** Unmount / total wall only — must not abort in-flight NIP-50 when the “first hits + …ms” scheduling cutoff runs. */
    const runAbort = new AbortController()
    let masterTimer: ReturnType<typeof setTimeout> | null = null
    let stopSchedulingTimer: ReturnType<typeof setTimeout> | null = null
    const myRun = ++runGeneration.current
    const cleanupInvalidatePreviousRun = () => {
      runGeneration.current += 1
    }
    const dispose = () => {
      if (masterTimer != null) {
        clearTimeout(masterTimer)
        masterTimer = null
      }
      if (stopSchedulingTimer != null) {
        clearTimeout(stopSchedulingTimer)
        stopSchedulingTimer = null
      }
      runAbort.abort()
      cleanupInvalidatePreviousRun()
    }

    if (!q || normalizedRelays.length === 0) {
      setLocalSearchRow(null)
      setRelayRows([])
      setMergedHits([])
      return dispose
    }

    const kindsArr = [...kinds]
    const filter: Filter = {
      search: q,
      kinds: kindsArr,
      limit: FULL_TEXT_SEARCH_PER_RELAY_LIMIT
    }

    const poolSize = Math.min(FULL_TEXT_SEARCH_RELAY_CONCURRENCY, normalizedRelays.length)

    setLocalSearchRow({ phase: 'loading', hitCount: 0, rawCount: 0 })
    setRelayRows(
      normalizedRelays.map((relayUrl) => ({
        relayUrl,
        host: relayHostForSubscribeLog(relayUrl),
        phase: 'loading'
      }))
    )
    setMergedHits([])
    setRelayInfoByKey({})

    /** Set when the first {@link runOneRelay} begins (first real NIP-50 query); master wall clock starts then. */
    let waveT0: number | null = null
    /**
     * After first preview-visible relay hits: may stop dequeuing *extra* relays after a short delay,
     * but every index relay in the list still gets one REQ (see worker loop).
     */
    let stopSchedulingNewRelays = false
    /** Only after ≥1 preview-visible event from a relay: arm the early scheduling cutoff (empty EOSE must not shorten). */
    let appliedRelativeSchedulingCutoff = false

    const scheduleMasterWallAbort = () => {
      if (masterTimer != null) {
        clearTimeout(masterTimer)
        masterTimer = null
      }
      if (waveT0 === null) return
      const ms = Math.max(0, waveT0 + SEARCH_TOTAL_WALL_MS - Date.now())
      masterTimer = setTimeout(() => {
        masterTimer = null
        stopSchedulingNewRelays = true
        runAbort.abort()
      }, ms)
    }

    const beginWaveIfNeeded = () => {
      if (waveT0 !== null) return
      waveT0 = Date.now()
      scheduleMasterWallAbort()
    }

    const onFirstPreviewVisibleRelayHits = () => {
      if (appliedRelativeSchedulingCutoff || waveT0 === null) return
      appliedRelativeSchedulingCutoff = true
      if (stopSchedulingTimer != null) {
        clearTimeout(stopSchedulingTimer)
      }
      stopSchedulingTimer = setTimeout(() => {
        stopSchedulingTimer = null
        stopSchedulingNewRelays = true
      }, SEARCH_AFTER_FIRST_RELAY_MS)
    }

    runAbort.signal.addEventListener(
      'abort',
      () => {
        setRelayRows((prev) =>
          prev.map((r) =>
            r.phase === 'loading'
              ? { ...r, phase: 'done' as const, eventCount: 0, ms: undefined, errorMessage: undefined }
              : r
          )
        )
      },
      { once: true }
    )

    let relayCursor = 0
    const nextRelayUrl = (): string | undefined => {
      if (relayCursor >= normalizedRelays.length) return undefined
      return normalizedRelays[relayCursor++]!
    }

    const applyMergedUpdate = (
      mutate: (map: Map<string, { event: Event; relays: Set<string>; local: boolean }>) => void
    ) => {
      setMergedHits((prev) => {
        const urlByKey = new Map<string, string>()
        for (const u of normalizedRelays) {
          urlByKey.set(relayKey(u), normalizeUrl(u) || u)
        }
        const map = new Map<string, { event: Event; relays: Set<string>; local: boolean }>()
        for (const hit of prev) {
          map.set(hit.event.id, {
            event: hit.event,
            relays: new Set(hit.relayUrls.map((u) => relayKey(u))),
            local: hit.fromLocalArchive ?? false
          })
        }
        mutate(map)
        return [...map.values()]
          .map(({ event, relays, local }) => {
            const relayUrls = sortRelaysByHost(
              [...relays].map((k) => urlByKey.get(k) || k).filter((u) => /^wss?:\/\//i.test(u))
            )
            const row: MergedHit = { event, relayUrls }
            if (local) row.fromLocalArchive = true
            return row
          })
          .filter((h) => h.relayUrls.length > 0 || h.fromLocalArchive)
          .sort((a, b) => compareMergedNip50SearchHits(q, a, b))
          .slice(0, FULL_TEXT_SEARCH_MAX_MERGED_EVENTS)
      })
    }

    const mergeIntoHits = (relayUrl: string, events: Event[]) => {
      const rk = relayKey(relayUrl)
      applyMergedUpdate((map) => {
        for (const ev of events) {
          if (!mergedSearchNoteHasPreviewBody(ev)) continue
          const cur = map.get(ev.id)
          if (cur) {
            cur.relays.add(rk)
          } else {
            map.set(ev.id, { event: ev, relays: new Set([rk]), local: false })
          }
        }
      })
    }

    void (async () => {
      const localT0 = performance.now()
      try {
        const mergedLocal = await collectLocalEventsForTextSearch({
          query: q,
          allowedKinds: kindsArr,
          sessionCap: 220,
          idbMergedLimit: 120,
          archiveScanMaxMs: 15_000,
          includeOtherStoresFullText: true,
          fullTextStoreHitCap: 260
        })
        if (myRun !== runGeneration.current || runAbort.signal.aborted) return
        const mergedLocalMatching = mergedLocal.filter((e) => mergedSearchNoteHasPreviewBody(e))
        const localMs = Math.round(performance.now() - localT0)
        setLocalSearchRow({
          phase: 'done',
          hitCount: mergedLocalMatching.length,
          rawCount: mergedLocal.length,
          ms: localMs
        })
        if (mergedLocalMatching.length > 0) {
          applyMergedUpdate((map) => {
            for (const ev of mergedLocalMatching) {
              const cur = map.get(ev.id)
              if (cur) {
                cur.local = true
              } else {
                map.set(ev.id, { event: ev, relays: new Set(), local: true })
              }
            }
          })
          void addSearchEventsToSessionCacheBatched(mergedLocalMatching, runGeneration, myRun)
        }
      } catch (err) {
        if (myRun !== runGeneration.current) return
        setLocalSearchRow({
          phase: 'error',
          hitCount: 0,
          rawCount: 0,
          ms: Math.round(performance.now() - localT0),
          errorMessage: err instanceof Error ? err.message : String(err)
        })
      }
    })()

    const runOneRelay = async (relayUrl: string) => {
      if (myRun !== runGeneration.current || runAbort.signal.aborted) return
      beginWaveIfNeeded()
      const t0 = performance.now()
      try {
        const { events: raw, connectionError } = await client.fetchEventsFromSingleRelay(
          relayUrl,
          filter,
          { globalTimeout: SEARCH_PER_RELAY_QUERY_MS, signal: runAbort.signal }
        )
        if (myRun !== runGeneration.current) return

        const sorted = [...raw]
          .sort((a, b) => compareMergedNip50SearchHits(q, { event: a }, { event: b }))
          .slice(0, FULL_TEXT_SEARCH_MAX_NOTES_PER_RELAY)
        const previewVisible = sorted.filter((e) => mergedSearchNoteHasPreviewBody(e))

        const ms = Math.round(performance.now() - t0)
        if (previewVisible.length === 0 && connectionError) {
          setRelayRows((prev) =>
            prev.map((r) =>
              r.relayUrl === relayUrl
                ? {
                    ...r,
                    phase: 'error',
                    eventCount: 0,
                    rawEventCount: sorted.length,
                    ms,
                    errorMessage: connectionError
                  }
                : r
            )
          )
          return
        }

        mergeIntoHits(relayUrl, sorted)
        void addSearchEventsToSessionCacheBatched(previewVisible, runGeneration, myRun)

        if (previewVisible.length > 0) {
          onFirstPreviewVisibleRelayHits()
        }
        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl
              ? {
                  ...r,
                  phase: 'done',
                  eventCount: previewVisible.length,
                  rawEventCount: sorted.length,
                  ms,
                  errorMessage: previewVisible.length > 0 ? undefined : connectionError
                }
              : r
          )
        )
      } catch (err) {
        if (myRun !== runGeneration.current) return
        if (runAbort.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        const ms = Math.round(performance.now() - t0)
        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl
              ? { ...r, phase: 'error', eventCount: 0, rawEventCount: 0, ms, errorMessage: msg }
              : r
          )
        )
      }
    }

    const worker = async () => {
      while (myRun === runGeneration.current && !runAbort.signal.aborted) {
        if (stopSchedulingNewRelays && relayCursor >= normalizedRelays.length) break
        const relayUrl = nextRelayUrl()
        if (!relayUrl) break
        await runOneRelay(relayUrl)
      }
    }

    void (async () => {
      try {
        await Promise.all(Array.from({ length: poolSize }, () => worker()))
      } catch {
        /* runOneRelay already updates relay rows */
      }
    })()

    return dispose
  }, [q, normalizedRelays, kinds])

  if (!q) {
    return null
  }

  return (
    <div className="min-w-0 space-y-3" aria-busy={anyLoading}>
      <p className="text-sm text-muted-foreground leading-snug">
        {t('Full-text search merged intro', {
          relayCount: normalizedRelays.length,
          totalSeconds: Math.round(SEARCH_TOTAL_WALL_MS / 1000),
          afterFirstSeconds: Math.round(SEARCH_AFTER_FIRST_RELAY_MS / 1000),
          concurrency: FULL_TEXT_SEARCH_RELAY_CONCURRENCY
        })}
      </p>

      <SearchSourceProgressList
        localRow={localSearchRow}
        relayRows={relayRows}
        relayInfoByKey={relayInfoByKey}
        anyLoading={anyLoading}
      />

      <SearchMergedProfileProvider resetKey={searchProfileResetKey} mergedHits={mergedHits}>
        <div className="min-w-0 space-y-2">
          {anyLoading && mergedHits.length === 0 && (
            <div className="space-y-2" aria-label={t('Full-text search relay querying')}>
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
            </div>
          )}

          {mergedHits.map((hit) => (
            <article
              key={hit.event.id}
              className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-border hover:bg-muted/15 hover:shadow-sm"
            >
              {(hit.relayUrls.length > 0 || hit.fromLocalArchive) && (
                <div
                  className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2.5 py-1"
                  aria-label={
                    hit.relayUrls.length > 0
                      ? t('Full-text search seen on relays')
                      : t('Full-text search local archive description')
                  }
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90 shrink-0">
                    {t('Full-text search seen on label')}
                  </span>
                  <div className="flex flex-wrap items-center gap-0.5">
                    {hit.relayUrls.map((url) => (
                      <button
                        key={`${hit.event.id}-${relayKey(url)}`}
                        type="button"
                        title={relayHostForSubscribeLog(url)}
                        className="inline-flex shrink-0 rounded-sm opacity-90 ring-offset-background hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigateToRelay(toRelay(url))
                        }}
                      >
                        <RelayIcon
                          url={url}
                          className="h-5 w-5 rounded-sm"
                          iconSize={12}
                          relayInfo={relayInfoByKey[relayKey(url)]}
                          skipRelayInfoFetch
                        />
                      </button>
                    ))}
                    {hit.fromLocalArchive && (
                      <span
                        className="ml-0.5 inline-flex shrink-0 rounded-sm border border-border/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90"
                        title={t('Full-text search local archive description')}
                      >
                        {t('Full-text search local archive badge')}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <NoteCard
                event={hit.event}
                className="w-full border-0 bg-transparent shadow-none"
                filterMutedNotes
                fetchNoteStatsIfMissing={false}
                deferAuthorAvatar
                searchListPreview
              />
            </article>
          ))}
        </div>
      </SearchMergedProfileProvider>

      {allTerminal && mergedHits.length === 0 && (
        <div className="flex flex-col items-start gap-0" role="status">
          <p className="text-sm text-muted-foreground">{t('Full-text search empty merged')}</p>
          {alexandriaEmptyHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaEmptyHref} /> : null}
        </div>
      )}

      {allTerminal && mergedHits.length > 0 && (
        <p className="text-sm text-muted-foreground border-t pt-3" role="status">
          {t('Full-text search all relays finished')}
        </p>
      )}
    </div>
  )
}
