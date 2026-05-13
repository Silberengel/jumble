import NoteCard from '@/components/NoteCard'
import RelayIcon from '@/components/RelayIcon'
import { Skeleton } from '@/components/ui/skeleton'
import { compareEventsForDTagQuery } from '@/lib/dtag-search'
import logger from '@/lib/logger'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { normalizeUrl } from '@/lib/url'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import client from '@/services/client.service'
import { relayHostForSubscribeLog } from '@/services/relay-operation-log.service'
import type { TProfile } from '@/types'
import type { Event, Filter } from 'nostr-tools'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type MergedHit = {
  event: Event
  relayUrls: string[]
}

/** One-shot NIP-50 REQ per relay; bounded wait so the page always reaches a terminal state (see QueryService NIP-50 global floor). */
const FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS = 45_000
/** Avoid opening every index relay at once (pool + main thread); still completes all relays. */
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

type RelayFetchPhase = 'loading' | 'done' | 'error'

type RelayFetchRow = {
  relayUrl: string
  host: string
  phase: RelayFetchPhase
  eventCount?: number
  ms?: number
  errorMessage?: string
}

function normalizeRelayList(urls: readonly string[]): string[] {
  return Array.from(
    new Set(urls.map((u) => normalizeUrl(u) || u.trim()).filter((u): u is string => u.length > 0))
  ).sort((a, b) => relayHostForSubscribeLog(a).localeCompare(relayHostForSubscribeLog(b)))
}

function relayKey(url: string): string {
  return (normalizeUrl(url) || url.trim()).toLowerCase()
}

function sortRelaysByHost(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean) as string[])).sort((a, b) =>
    relayHostForSubscribeLog(a).localeCompare(relayHostForSubscribeLog(b))
  )
}

/** Console hint: what this one-shot outcome suggests about NIP-50 (never proof without NIP-11). */
function nip50OutcomeHint(args: {
  phase: 'done' | 'error'
  rawCount: number
  connectionError?: string
}): string {
  if (args.phase === 'error') {
    return 'no_transport_or_relay_closed_request — cannot tell NIP-50 from this run'
  }
  if (args.rawCount > 0) {
    return 'returned_events_for_REQ_with_search_field — relay likely honors NIP-50 for this query (verify with NIP-11 supported_nips)'
  }
  if (args.connectionError) {
    return 'zero_events_but_connection_error_message — partial failure or restrictive CLOSE; NIP-50 unclear'
  }
  return 'zero_events_clean_close — no_hits_or_search_ignored_or_empty_index — cannot distinguish without NIP-11 or a known match'
}

export default function FullTextSearchByRelay({
  searchQuery,
  relayUrls,
  kinds
}: {
  searchQuery: string
  relayUrls: readonly string[]
  kinds: readonly number[]
}) {
  const { t } = useTranslation()
  const runGeneration = useRef(0)
  const [relayRows, setRelayRows] = useState<RelayFetchRow[]>([])
  const [mergedHits, setMergedHits] = useState<MergedHit[]>([])

  const normalizedRelays = useMemo(() => normalizeRelayList(relayUrls), [relayUrls])

  const q = searchQuery.trim()
  const timeoutSec = Math.round(FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS / 1000)
  const searchProfileResetKey = useMemo(
    () => `${q}\n${normalizedRelays.join('\n')}`,
    [q, normalizedRelays]
  )

  const doneRelayCount = relayRows.filter((r) => r.phase === 'done' || r.phase === 'error').length
  const errorRelayCount = relayRows.filter((r) => r.phase === 'error').length
  const anyLoading = relayRows.some((r) => r.phase === 'loading')
  const allTerminal =
    relayRows.length > 0 && relayRows.every((r) => r.phase === 'done' || r.phase === 'error')

  useEffect(() => {
    const myRun = ++runGeneration.current
    if (!q || normalizedRelays.length === 0) {
      setRelayRows([])
      setMergedHits([])
      return
    }

    const cleanupInvalidatePreviousRun = () => {
      runGeneration.current += 1
    }

    const filter: Filter = {
      search: q,
      kinds: [...kinds],
      limit: FULL_TEXT_SEARCH_PER_RELAY_LIMIT
    }

    const poolSize = Math.min(FULL_TEXT_SEARCH_RELAY_CONCURRENCY, normalizedRelays.length)

    setRelayRows(
      normalizedRelays.map((relayUrl) => ({
        relayUrl,
        host: relayHostForSubscribeLog(relayUrl),
        phase: 'loading'
      }))
    )
    setMergedHits([])

    let relayCursor = 0
    const nextRelayUrl = (): string | undefined => {
      if (relayCursor >= normalizedRelays.length) return undefined
      return normalizedRelays[relayCursor++]!
    }

    const mergeIntoHits = (relayUrl: string, events: Event[]) => {
      const rk = relayKey(relayUrl)
      setMergedHits((prev) => {
        const map = new Map<string, { event: Event; relays: Set<string> }>()
        for (const hit of prev) {
          map.set(hit.event.id, { event: hit.event, relays: new Set(hit.relayUrls.map((u) => relayKey(u))) })
        }
        for (const ev of events) {
          const cur = map.get(ev.id)
          if (cur) {
            cur.relays.add(rk)
          } else {
            map.set(ev.id, { event: ev, relays: new Set([rk]) })
          }
        }
        const urlByKey = new Map<string, string>()
        for (const u of normalizedRelays) {
          urlByKey.set(relayKey(u), normalizeUrl(u) || u)
        }
        return [...map.values()]
          .map(({ event, relays }) => ({
            event,
            relayUrls: sortRelaysByHost([...relays].map((k) => urlByKey.get(k) || k))
          }))
          .sort((a, b) => compareEventsForDTagQuery(q, a.event, b.event))
          .slice(0, FULL_TEXT_SEARCH_MAX_MERGED_EVENTS)
      })
    }

    const runOneRelay = async (relayUrl: string) => {
      const host = relayHostForSubscribeLog(relayUrl)
      logger.debug('[NIP-50 full-text] card_begin', {
        runId: myRun,
        relayUrl,
        host,
        timeoutMs: FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS,
        filter: { search: filter.search, kinds: filter.kinds, limit: filter.limit }
      })

      const t0 = performance.now()
      try {
        const { events: raw, connectionError } = await client.fetchEventsFromSingleRelay(
          relayUrl,
          filter,
          { globalTimeout: FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS }
        )
        if (myRun !== runGeneration.current) return

        const sorted = [...raw]
          .sort((a, b) => compareEventsForDTagQuery(q, a, b))
          .slice(0, FULL_TEXT_SEARCH_MAX_NOTES_PER_RELAY)
        await addSearchEventsToSessionCacheBatched(sorted, runGeneration, myRun)
        if (myRun !== runGeneration.current) return
        const ms = Math.round(performance.now() - t0)
        if (sorted.length === 0 && connectionError) {
          logger.debug('[NIP-50 full-text] card_end', {
            runId: myRun,
            relayUrl,
            host,
            phase: 'error' as const,
            ms,
            eventCountRaw: raw.length,
            eventCountShown: 0,
            connectionError,
            cardErrorMessage: connectionError,
            nip50Hint: nip50OutcomeHint({ phase: 'error', rawCount: 0, connectionError })
          })
          setRelayRows((prev) =>
            prev.map((r) =>
              r.relayUrl === relayUrl
                ? { ...r, phase: 'error', eventCount: 0, ms, errorMessage: connectionError }
                : r
            )
          )
          return
        }

        mergeIntoHits(relayUrl, sorted)

        logger.debug('[NIP-50 full-text] card_end', {
          runId: myRun,
          relayUrl,
          host,
          phase: 'done' as const,
          ms,
          eventCountRaw: raw.length,
          eventCountShown: sorted.length,
          connectionError: sorted.length > 0 ? undefined : connectionError,
          cardNote:
            sorted.length === 0 && connectionError
              ? 'UI shows soft warning (empty with message)'
              : sorted.length === 0
                ? 'UI empty state'
                : 'UI lists notes',
          nip50Hint: nip50OutcomeHint({
            phase: 'done',
            rawCount: raw.length,
            connectionError: sorted.length > 0 ? undefined : connectionError
          })
        })

        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl
              ? {
                  ...r,
                  phase: 'done',
                  eventCount: sorted.length,
                  ms,
                  errorMessage: sorted.length > 0 ? undefined : connectionError
                }
              : r
          )
        )
      } catch (err) {
        if (myRun !== runGeneration.current) return
        const msg = err instanceof Error ? err.message : String(err)
        const ms = Math.round(performance.now() - t0)
        logger.debug('[NIP-50 full-text] card_end', {
          runId: myRun,
          relayUrl,
          host,
          phase: 'error' as const,
          ms,
          eventCountRaw: 0,
          eventCountShown: 0,
          connectionError: undefined,
          cardErrorMessage: msg,
          nip50Hint: nip50OutcomeHint({ phase: 'error', rawCount: 0 })
        })
        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl ? { ...r, phase: 'error', eventCount: 0, ms, errorMessage: msg } : r
          )
        )
      }
    }

    const worker = async () => {
      while (myRun === runGeneration.current) {
        const relayUrl = nextRelayUrl()
        if (!relayUrl) break
        await runOneRelay(relayUrl)
      }
    }

    void (async () => {
      logger.debug('[NIP-50 full-text] wave_begin', {
        runId: myRun,
        query: q,
        relayCount: normalizedRelays.length,
        concurrency: poolSize,
        filter: { search: filter.search, kinds: filter.kinds, limit: filter.limit },
        relays: normalizedRelays.map((u) => ({ url: u, host: relayHostForSubscribeLog(u) }))
      })
      try {
        await Promise.all(Array.from({ length: poolSize }, () => worker()))
      } catch {
        /* runOneRelay already updates relay rows */
      }
      if (myRun !== runGeneration.current) return
      logger.debug('[NIP-50 full-text] wave_end', {
        runId: myRun,
        relayCount: normalizedRelays.length,
        note: 'matches UI "all relays finished" when every relay row is done or error'
      })
    })()

    return cleanupInvalidatePreviousRun
  }, [q, normalizedRelays, kinds])

  if (!q) {
    return null
  }

  return (
    <div className="min-w-0 space-y-3" aria-busy={anyLoading}>
      <p className="text-sm text-muted-foreground leading-snug">
        {t('Full-text search merged intro', {
          relayCount: normalizedRelays.length,
          seconds: timeoutSec,
          concurrency: FULL_TEXT_SEARCH_RELAY_CONCURRENCY
        })}
      </p>

      {relayRows.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-2" role="status">
          {anyLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
          {t('Full-text search progress relays', { done: doneRelayCount, total: relayRows.length })}
        </p>
      )}

      {errorRelayCount > 0 && allTerminal && (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="status">
          {t('Full-text search relay errors summary', { count: errorRelayCount })}
        </p>
      )}

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
              <div
                className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2.5 py-1"
                aria-label={t('Full-text search seen on relays')}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90 shrink-0">
                  {t('Full-text search seen on label')}
                </span>
                <div className="flex flex-wrap items-center gap-0.5">
                  {hit.relayUrls.map((url) => (
                    <span
                      key={`${hit.event.id}-${relayKey(url)}`}
                      title={relayHostForSubscribeLog(url)}
                      className="inline-flex shrink-0 opacity-90"
                    >
                      <RelayIcon url={url} skipRelayInfoFetch className="h-5 w-5 rounded-sm" iconSize={12} />
                    </span>
                  ))}
                </div>
              </div>
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
        <p className="text-sm text-muted-foreground" role="status">
          {t('Full-text search empty merged')}
        </p>
      )}

      {allTerminal && mergedHits.length > 0 && (
        <p className="text-sm text-muted-foreground border-t pt-3" role="status">
          {t('Full-text search all relays finished')}
        </p>
      )}
    </div>
  )
}
