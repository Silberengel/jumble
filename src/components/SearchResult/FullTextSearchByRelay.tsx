import NoteCard from '@/components/NoteCard'
import RelayIcon from '@/components/RelayIcon'
import { Skeleton } from '@/components/ui/skeleton'
import { compareEventsForDTagQuery, compareMergedGeneralSearchHits } from '@/lib/dtag-search'
import {
  fetchGeneralSearchEventsFromRelay,
  GENERAL_SEARCH_AFTER_FIRST_HITS_MS,
  GENERAL_SEARCH_LOCAL_WALL_MS,
  GENERAL_SEARCH_RELAY_CONCURRENCY,
  GENERAL_SEARCH_RELAY_WALL_MS,
  GENERAL_SEARCH_PER_RELAY_QUERY_MS,
  generalSearchRelayKey,
  normalizeGeneralSearchRelayList,
  type GeneralSearchRelayFetchRow
} from '@/lib/general-search-relay-wave'
import { mergedSearchNoteHasPreviewBody } from '@/lib/merged-search-note-preview'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'
import { searchArchivesNotesForGeneralSearch } from '@/lib/nostr-archives-search'
import { useNostrArchivesAvailable } from '@/hooks/useNostrArchivesAvailable'
import { toRelay } from '@/lib/link'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import { fetchProfilesMetadataBatch } from '@/lib/profile-metadata-batch'
import client from '@/services/client.service'
import { relayHostForSubscribeLog } from '@/services/relay-operation-log.service'
import type { TProfile } from '@/types'
import type { Event } from 'nostr-tools'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'
import { buildAlexandriaEventsSearchUrlFromNotesQuery } from '@/lib/alexandria-events-search-url'
import { Archive, HardDrive, Loader2, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSmartRelayNavigationOptional } from '@/PageManager'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type SearchHitSource = 'local' | 'archives' | 'relay'

type SearchHit = {
  event: Event
  source: SearchHitSource
  relayUrls?: string[]
}

const LOCAL_SEARCH_MAX_EVENTS = 150
const SEARCH_MERGED_PROFILE_CHUNK = 80
const SEARCH_MERGED_PROFILE_DEBOUNCE_MS = 240
const ADD_TO_CACHE_PER_FRAME = 8

function sortRelaysByHost(urls: readonly string[]): string[] {
  return normalizeGeneralSearchRelayList(urls)
}

function extractHitAuthorPubkeys(hits: SearchHit[]): string[] {
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

function SearchMergedProfileProvider({
  resetKey,
  hits,
  children
}: {
  resetKey: string
  hits: SearchHit[]
  children: ReactNode
}) {
  const [batch, setBatch] = useState(() => ({
    profiles: new Map<string, TProfile>(),
    pending: new Set<string>(),
    version: 0
  }))
  const hitsRef = useRef(hits)
  hitsRef.current = hits
  const fetchAttemptedRef = useRef(new Set<string>())

  useEffect(() => {
    fetchAttemptedRef.current = new Set()
    setBatch({ profiles: new Map(), pending: new Set(), version: 0 })
  }, [resetKey])

  const hitsIdentity = useMemo(
    () =>
      [...hits]
        .map((h) => h.event.id)
        .sort()
        .join('\x1e'),
    [hits]
  )

  useEffect(() => {
    if (!hitsIdentity) return
    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      const currentHits = hitsRef.current
      const pubkeys = extractHitAuthorPubkeys(currentHits)
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
            profiles = await fetchProfilesMetadataBatch(chunk)
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

type LocalSearchPhase = 'loading' | 'done' | 'error'

type LocalSearchRow = {
  phase: LocalSearchPhase
  hitCount: number
  rawCount: number
  ms?: number
  errorMessage?: string
}

function formatLocalStatusLabel(
  row: LocalSearchRow,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (row.phase === 'loading') return t('Full-text search source loading')
  if (row.phase === 'error') {
    const msg = row.errorMessage?.trim()
    return msg && msg.length <= 120 ? msg : t('Full-text search relay error')
  }
  const shown = row.hitCount
  const raw = row.rawCount
  if (shown === 0 && raw === 0) return t('Full-text search source zero hits')
  if (raw > shown) return t('Full-text search source hits with raw', { shown, raw })
  return t('Full-text search source hits', { count: shown })
}

function mergeSearchHits(
  query: string,
  localArchives: SearchHit[],
  relayHits: { event: Event; relayUrls: string[] }[]
): SearchHit[] {
  const byId = new Map<string, SearchHit>()
  for (const hit of localArchives) {
    byId.set(hit.event.id, hit)
  }
  for (const hit of relayHits) {
    if (byId.has(hit.event.id)) continue
    byId.set(hit.event.id, { event: hit.event, source: 'relay', relayUrls: hit.relayUrls })
  }
  return [...byId.values()]
    .sort((a, b) =>
      compareMergedGeneralSearchHits(
        query,
        { event: a.event, fromLocalArchive: a.source === 'local' || a.source === 'archives' },
        { event: b.event, fromLocalArchive: b.source === 'local' || b.source === 'archives' }
      )
    )
    .slice(0, LOCAL_SEARCH_MAX_EVENTS)
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
  const archivesAvailable = useNostrArchivesAvailable()
  const { navigateToRelay } = useSmartRelayNavigationOptional() ?? {
    navigateToRelay: (url: string) => {
      window.location.href = url
    }
  }
  const localRunGeneration = useRef(0)
  const relayRunGeneration = useRef(0)
  const [localRow, setLocalRow] = useState<LocalSearchRow | null>(null)
  const [archivesRow, setArchivesRow] = useState<LocalSearchRow | null>(null)
  const [localArchivesHits, setLocalArchivesHits] = useState<SearchHit[]>([])
  const [relayRows, setRelayRows] = useState<GeneralSearchRelayFetchRow[]>([])
  const [relayMergedHits, setRelayMergedHits] = useState<{ event: Event; relayUrls: string[] }[]>([])

  const normalizedRelays = useMemo(() => normalizeGeneralSearchRelayList(relayUrls), [relayUrls])
  const q = searchQuery.trim()
  const alexandriaEmptyHref = useMemo(() => {
    if (alexandriaEmptyHrefProp) return alexandriaEmptyHrefProp
    return q ? buildAlexandriaEventsSearchUrlFromNotesQuery(q) : null
  }, [alexandriaEmptyHrefProp, q])

  const searchProfileResetKey = useMemo(
    () => `${q}\n${normalizedRelays.join('\n')}`,
    [q, normalizedRelays]
  )

  const hits = useMemo(
    () => mergeSearchHits(q, localArchivesHits, relayMergedHits),
    [q, localArchivesHits, relayMergedHits]
  )

  const doneRelayCount = relayRows.filter((r) => r.phase === 'done' || r.phase === 'error').length
  const errorRelayCount = relayRows.filter((r) => r.phase === 'error').length
  const relayLoading = relayRows.some((r) => r.phase === 'loading')
  const relayAllTerminal =
    relayRows.length > 0 && relayRows.every((r) => r.phase === 'done' || r.phase === 'error')

  useEffect(() => {
    const myRun = ++localRunGeneration.current

    if (!q) {
      setLocalRow(null)
      setArchivesRow(null)
      setLocalArchivesHits([])
      return
    }

    const kindsArr = [...kinds]
    setLocalRow({ phase: 'loading', hitCount: 0, rawCount: 0 })
    setArchivesRow(archivesAvailable ? { phase: 'loading', hitCount: 0, rawCount: 0 } : null)
    setLocalArchivesHits([])

    void (async () => {
      const t0Local = performance.now()
      const t0Archives = performance.now()

      const localPromise = collectLocalEventsForTextSearch({
        query: q,
        allowedKinds: kindsArr,
        sessionCap: 220,
        idbMergedLimit: 120,
        totalMaxMs: GENERAL_SEARCH_LOCAL_WALL_MS,
        archiveScanMaxMs: 12_000,
        publicationScanBudget: 10_000,
        publicationScanMaxMs: 10_000,
        fullTextScanMaxMs: 8_000,
        includeOtherStoresFullText: true,
        fullTextStoreHitCap: 260
      })

      const archivesPromise = archivesAvailable
        ? searchArchivesNotesForGeneralSearch({ query: q, kinds: kindsArr, limit: 100 })
        : Promise.resolve({ ok: false, events: [], total: 0 })

      try {
        const mergedLocal = await localPromise
        if (myRun !== localRunGeneration.current) return
        const localVisible = mergedLocal
          .filter((e) => mergedSearchNoteHasPreviewBody(e))
          .sort((a, b) =>
            compareMergedGeneralSearchHits(q, { event: a, fromLocalArchive: true }, { event: b, fromLocalArchive: true })
          )

        setLocalRow({
          phase: 'done',
          hitCount: localVisible.length,
          rawCount: mergedLocal.length,
          ms: Math.round(performance.now() - t0Local)
        })

        const localHits: SearchHit[] = localVisible.map((event) => ({ event, source: 'local' }))
        let archivesHits: SearchHit[] = []

        if (archivesAvailable) {
          const archivesRes = await archivesPromise
          if (myRun !== localRunGeneration.current) return
          if (archivesRes.ok) {
            archivesHits = archivesRes.events.map((event) => ({ event, source: 'archives' as const }))
            setArchivesRow({
              phase: 'done',
              hitCount: archivesHits.length,
              rawCount: archivesRes.total,
              ms: Math.round(performance.now() - t0Archives)
            })
          } else {
            setArchivesRow({
              phase: 'error',
              hitCount: 0,
              rawCount: 0,
              ms: Math.round(performance.now() - t0Archives),
              errorMessage: t('Full-text search archives unavailable')
            })
          }
        }

        const byId = new Map<string, SearchHit>()
        for (const hit of localHits) byId.set(hit.event.id, hit)
        for (const hit of archivesHits) {
          if (!byId.has(hit.event.id)) byId.set(hit.event.id, hit)
        }
        const merged = [...byId.values()]
        setLocalArchivesHits(merged)
        if (merged.length > 0) {
          void addSearchEventsToSessionCacheBatched(
            merged.map((h) => h.event),
            localRunGeneration,
            myRun
          )
        }
      } catch (err) {
        if (myRun !== localRunGeneration.current) return
        setLocalRow({
          phase: 'error',
          hitCount: 0,
          rawCount: 0,
          ms: Math.round(performance.now() - t0Local),
          errorMessage: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  }, [q, kinds, archivesAvailable, t])

  useEffect(() => {
    const abort = new AbortController()
    let masterTimer: ReturnType<typeof setTimeout> | null = null
    const myRun = ++relayRunGeneration.current
    const dispose = () => {
      if (masterTimer != null) {
        clearTimeout(masterTimer)
        masterTimer = null
      }
      abort.abort()
    }

    if (!q || normalizedRelays.length === 0) {
      setRelayRows([])
      setRelayMergedHits([])
      return dispose
    }

    const kindsArr = [...kinds]
    const poolSize = Math.min(GENERAL_SEARCH_RELAY_CONCURRENCY, normalizedRelays.length)

    setRelayRows(
      normalizedRelays.map((relayUrl) => ({
        relayUrl,
        host: relayHostForSubscribeLog(relayUrl),
        phase: 'loading'
      }))
    )
    setRelayMergedHits([])

    let waveT0: number | null = null
    let waveEndAt = 0
    let appliedRelativeWaveCutoff = false

    const scheduleMasterAbort = () => {
      if (masterTimer != null) {
        clearTimeout(masterTimer)
        masterTimer = null
      }
      const ms = Math.max(0, waveEndAt - Date.now())
      masterTimer = setTimeout(() => {
        masterTimer = null
        abort.abort()
      }, ms)
    }

    const beginWaveIfNeeded = () => {
      if (waveT0 !== null) return
      waveT0 = Date.now()
      waveEndAt = waveT0 + GENERAL_SEARCH_RELAY_WALL_MS
      scheduleMasterAbort()
    }

    const onFirstSearchHits = () => {
      if (appliedRelativeWaveCutoff || waveT0 === null) return
      appliedRelativeWaveCutoff = true
      const now = Date.now()
      waveEndAt = Math.min(waveT0 + GENERAL_SEARCH_RELAY_WALL_MS, now + GENERAL_SEARCH_AFTER_FIRST_HITS_MS)
      scheduleMasterAbort()
    }

    abort.signal.addEventListener(
      'abort',
      () => {
        setRelayRows((prev) =>
          prev.map((r) =>
            r.phase === 'loading'
              ? { ...r, phase: 'done' as const, eventCount: 0, rawCount: 0, ms: undefined, errorMessage: undefined }
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

    const mergeIntoRelayHits = (relayUrl: string, events: Event[]) => {
      const rk = generalSearchRelayKey(relayUrl)
      setRelayMergedHits((prev) => {
        const map = new Map<string, { event: Event; relays: Set<string> }>()
        for (const hit of prev) {
          map.set(hit.event.id, {
            event: hit.event,
            relays: new Set(hit.relayUrls.map((u) => generalSearchRelayKey(u)))
          })
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
          urlByKey.set(generalSearchRelayKey(u), u)
        }
        return [...map.values()]
          .map(({ event, relays }) => ({
            event,
            relayUrls: sortRelaysByHost([...relays].map((k) => urlByKey.get(k) || k))
          }))
          .sort((a, b) => compareEventsForDTagQuery(q, a.event, b.event))
      })
    }

    const runOneRelay = async (relayUrl: string) => {
      if (myRun !== relayRunGeneration.current || abort.signal.aborted) return
      beginWaveIfNeeded()
      const t0 = performance.now()
      const remainingWaveMs = Math.max(500, waveEndAt - Date.now())
      const perRelayBudget = Math.min(GENERAL_SEARCH_PER_RELAY_QUERY_MS, remainingWaveMs)
      try {
        const { events, rawCount, connectionError } = await fetchGeneralSearchEventsFromRelay(
          relayUrl,
          q,
          kindsArr,
          { globalTimeout: perRelayBudget, signal: abort.signal }
        )
        if (myRun !== relayRunGeneration.current) return

        const ms = Math.round(performance.now() - t0)
        if (events.length === 0 && connectionError) {
          setRelayRows((prev) =>
            prev.map((r) =>
              r.relayUrl === relayUrl
                ? { ...r, phase: 'error', eventCount: 0, rawCount, ms, errorMessage: connectionError }
                : r
            )
          )
          return
        }

        mergeIntoRelayHits(relayUrl, events)
        void addSearchEventsToSessionCacheBatched(events, relayRunGeneration, myRun)

        if (events.length > 0) {
          onFirstSearchHits()
        }
        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl
              ? {
                  ...r,
                  phase: 'done',
                  eventCount: events.length,
                  rawCount,
                  ms,
                  errorMessage: events.length > 0 ? undefined : connectionError
                }
              : r
          )
        )
      } catch (err) {
        if (myRun !== relayRunGeneration.current) return
        if (abort.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        const ms = Math.round(performance.now() - t0)
        setRelayRows((prev) =>
          prev.map((r) =>
            r.relayUrl === relayUrl ? { ...r, phase: 'error', eventCount: 0, rawCount: 0, ms, errorMessage: msg } : r
          )
        )
      }
    }

    const worker = async () => {
      while (myRun === relayRunGeneration.current && !abort.signal.aborted) {
        const relayUrl = nextRelayUrl()
        if (!relayUrl) break
        await runOneRelay(relayUrl)
      }
    }

    void (async () => {
      try {
        await Promise.all(Array.from({ length: poolSize }, () => worker()))
      } catch {
        /* runOneRelay updates relay rows */
      }
    })()

    return dispose
  }, [q, normalizedRelays, kinds])

  if (!q) return null

  const localLoading = localRow?.phase === 'loading'
  const archivesLoading = archivesAvailable && archivesRow?.phase === 'loading'
  const loading = localLoading || archivesLoading || relayLoading
  const localDone = localRow != null && localRow.phase !== 'loading'
  const archivesDone = !archivesAvailable || (archivesRow != null && archivesRow.phase !== 'loading')
  const done = localDone && archivesDone && (normalizedRelays.length === 0 || relayAllTerminal)

  const relayHitCount = relayMergedHits.length

  return (
    <div className="min-w-0 space-y-3" aria-busy={loading}>
      <p className="text-sm text-muted-foreground leading-snug">
        {normalizedRelays.length > 0
          ? t('General search merged intro', {
              relayCount: normalizedRelays.length,
              localSeconds: Math.round(GENERAL_SEARCH_LOCAL_WALL_MS / 1000),
              totalSeconds: Math.round(GENERAL_SEARCH_RELAY_WALL_MS / 1000),
              afterFirstSeconds: Math.round(GENERAL_SEARCH_AFTER_FIRST_HITS_MS / 1000),
              concurrency: GENERAL_SEARCH_RELAY_CONCURRENCY
            })
          : t('Notes search local intro')}
      </p>

      {(localRow || archivesRow || relayRows.length > 0) && (
        <section
          className="rounded-lg border border-border/60 bg-muted/20 text-xs"
          aria-label={t('Full-text search sources progress')}
          aria-busy={loading}
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
                  {formatLocalStatusLabel(localRow, t)}
                  {localRow.ms != null && localRow.phase !== 'loading' ? (
                    <span className="text-muted-foreground"> · {localRow.ms} ms</span>
                  ) : null}
                </span>
                {localRow.phase === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
              </li>
            ) : null}
            {archivesRow ? (
              <li className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 shrink-0 font-medium text-foreground">
                  {t('Full-text search source archives')}
                </span>
                <span
                  className={cn(
                    'ml-auto min-w-0 text-right',
                    archivesRow.phase === 'error'
                      ? 'text-destructive'
                      : archivesRow.phase === 'loading'
                        ? 'text-muted-foreground'
                        : archivesRow.hitCount > 0
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                  )}
                >
                  {formatLocalStatusLabel(archivesRow, t)}
                  {archivesRow.ms != null && archivesRow.phase !== 'loading' ? (
                    <span className="text-muted-foreground"> · {archivesRow.ms} ms</span>
                  ) : null}
                </span>
                {archivesRow.phase === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
              </li>
            ) : null}
            {relayRows.length > 0 ? (
              <li className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 shrink-0 font-medium text-foreground">
                  {t('Full-text search source relays')}
                </span>
                <span
                  className={cn(
                    'ml-auto min-w-0 text-right',
                    relayLoading ? 'text-muted-foreground' : relayHitCount > 0 ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {relayLoading
                    ? t('Full-text search progress relays', {
                        done: doneRelayCount,
                        total: relayRows.length
                      })
                    : t('Full-text search source hits', { count: relayHitCount })}
                </span>
                {relayLoading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
              </li>
            ) : null}
          </ul>
        </section>
      )}

      {errorRelayCount > 0 && relayAllTerminal && (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="status">
          {t('Full-text search relay errors summary', { count: errorRelayCount })}
        </p>
      )}

      <SearchMergedProfileProvider resetKey={searchProfileResetKey} hits={hits}>
        <div className="min-w-0 space-y-2">
          {loading && hits.length === 0 && (
            <div className="space-y-2" aria-label={t('Full-text search source loading')}>
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
            </div>
          )}

          {hits.map((hit) => (
            <article
              key={hit.event.id}
              className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-border hover:bg-muted/15 hover:shadow-sm"
            >
              <div
                className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2.5 py-1"
                aria-label={
                  hit.source === 'relay'
                    ? t('Full-text search seen on relays')
                    : hit.source === 'archives'
                      ? t('Full-text search archives description')
                      : t('Full-text search local archive description')
                }
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90 shrink-0">
                  {t('Full-text search seen on label')}
                </span>
                {hit.source === 'relay' && hit.relayUrls?.length ? (
                  <div className="flex flex-wrap items-center gap-0.5">
                    {hit.relayUrls.map((url) => (
                      <button
                        key={`${hit.event.id}-${generalSearchRelayKey(url)}`}
                        type="button"
                        title={relayHostForSubscribeLog(url)}
                        className="inline-flex shrink-0 rounded-sm opacity-90 ring-offset-background hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigateToRelay(toRelay(url))
                        }}
                      >
                        <RelayIcon url={url} className="h-5 w-5 rounded-sm" iconSize={12} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <span
                    className="inline-flex shrink-0 rounded-sm border border-border/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90"
                    title={
                      hit.source === 'archives'
                        ? t('Full-text search archives description')
                        : t('Full-text search local archive description')
                    }
                  >
                    {hit.source === 'archives'
                      ? t('Full-text search archives badge')
                      : t('Full-text search local archive badge')}
                  </span>
                )}
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

      {done && hits.length === 0 && (
        <div className="flex flex-col items-start gap-0" role="status">
          <p className="text-sm text-muted-foreground">
            {normalizedRelays.length > 0
              ? t('Full-text search empty merged')
              : t('Full-text search empty local')}
          </p>
          {alexandriaEmptyHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaEmptyHref} /> : null}
        </div>
      )}
    </div>
  )
}
