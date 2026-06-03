import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { compareMergedGeneralSearchHits } from '@/lib/dtag-search'
import { mergedSearchNoteHasPreviewBody } from '@/lib/merged-search-note-preview'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'
import { searchArchivesNotesForGeneralSearch } from '@/lib/nostr-archives-search'
import { useNostrArchivesAvailable } from '@/hooks/useNostrArchivesAvailable'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import { fetchProfilesMetadataBatch } from '@/lib/profile-metadata-batch'
import client from '@/services/client.service'
import type { TProfile } from '@/types'
import type { Event } from 'nostr-tools'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'
import { buildAlexandriaEventsSearchUrlFromNotesQuery } from '@/lib/alexandria-events-search-url'
import { Archive, HardDrive, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type SearchHitSource = 'local' | 'archives'

type LocalHit = {
  event: Event
  source: SearchHitSource
}

const LOCAL_SEARCH_MAX_EVENTS = 150
const SEARCH_MERGED_PROFILE_CHUNK = 80
const SEARCH_MERGED_PROFILE_DEBOUNCE_MS = 240
const ADD_TO_CACHE_PER_FRAME = 8

function extractHitAuthorPubkeys(hits: LocalHit[]): string[] {
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
  hits: LocalHit[]
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

export default function FullTextSearchByRelay({
  searchQuery,
  kinds,
  alexandriaEmptyHref: alexandriaEmptyHrefProp = null
}: {
  searchQuery: string
  kinds: readonly number[]
  alexandriaEmptyHref?: string | null
}) {
  const { t } = useTranslation()
  const archivesAvailable = useNostrArchivesAvailable()
  const runGeneration = useRef(0)
  const [localRow, setLocalRow] = useState<LocalSearchRow | null>(null)
  const [archivesRow, setArchivesRow] = useState<LocalSearchRow | null>(null)
  const [hits, setHits] = useState<LocalHit[]>([])

  const q = searchQuery.trim()
  const alexandriaEmptyHref = useMemo(() => {
    if (alexandriaEmptyHrefProp) return alexandriaEmptyHrefProp
    return q ? buildAlexandriaEventsSearchUrlFromNotesQuery(q) : null
  }, [alexandriaEmptyHrefProp, q])

  const searchProfileResetKey = q

  useEffect(() => {
    const myRun = ++runGeneration.current

    if (!q) {
      setLocalRow(null)
      setArchivesRow(null)
      setHits([])
      return
    }

    const kindsArr = [...kinds]
    setLocalRow({ phase: 'loading', hitCount: 0, rawCount: 0 })
    setArchivesRow(archivesAvailable ? { phase: 'loading', hitCount: 0, rawCount: 0 } : null)
    setHits([])

    void (async () => {
      const t0Local = performance.now()
      const t0Archives = performance.now()

      const localPromise = collectLocalEventsForTextSearch({
        query: q,
        allowedKinds: kindsArr,
        sessionCap: 220,
        idbMergedLimit: 120,
        archiveScanMaxMs: 15_000,
        includeOtherStoresFullText: true,
        fullTextStoreHitCap: 260
      })

      const archivesPromise = archivesAvailable
        ? searchArchivesNotesForGeneralSearch({ query: q, kinds: kindsArr, limit: 100 })
        : Promise.resolve({ ok: false, events: [], total: 0 })

      let mergedLocal: Event[] = []
      let localError: string | undefined
      try {
        mergedLocal = await localPromise
        if (myRun !== runGeneration.current) return
        const localVisible = mergedLocal
          .filter((e) => mergedSearchNoteHasPreviewBody(e))
          .sort((a, b) => compareMergedGeneralSearchHits(q, { event: a, fromLocalArchive: true }, { event: b, fromLocalArchive: true }))

        setLocalRow({
          phase: 'done',
          hitCount: localVisible.length,
          rawCount: mergedLocal.length,
          ms: Math.round(performance.now() - t0Local)
        })

        let archivesEvents: Event[] = []
        if (archivesAvailable) {
          const archivesRes = await archivesPromise
          if (myRun !== runGeneration.current) return
          if (archivesRes.ok) {
            archivesEvents = archivesRes.events
            setArchivesRow({
              phase: 'done',
              hitCount: archivesEvents.length,
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

        const byId = new Map<string, LocalHit>()
        for (const event of localVisible) {
          byId.set(event.id, { event, source: 'local' })
        }
        for (const event of archivesEvents) {
          if (!byId.has(event.id)) {
            byId.set(event.id, { event, source: 'archives' })
          }
        }

        const mergedHits = [...byId.values()]
          .sort((a, b) =>
            compareMergedGeneralSearchHits(q, {
              event: a.event,
              fromLocalArchive: a.source === 'local'
            }, {
              event: b.event,
              fromLocalArchive: b.source === 'local'
            })
          )
          .slice(0, LOCAL_SEARCH_MAX_EVENTS)

        setHits(mergedHits)
        if (mergedHits.length > 0) {
          void addSearchEventsToSessionCacheBatched(
            mergedHits.map((h) => h.event),
            runGeneration,
            myRun
          )
        }
      } catch (err) {
        if (myRun !== runGeneration.current) return
        localError = err instanceof Error ? err.message : String(err)
        setLocalRow({
          phase: 'error',
          hitCount: 0,
          rawCount: 0,
          ms: Math.round(performance.now() - t0Local),
          errorMessage: localError
        })
        if (archivesAvailable) {
          try {
            const archivesRes = await archivesPromise
            if (myRun !== runGeneration.current) return
            if (archivesRes.ok && archivesRes.events.length > 0) {
              const mergedHits = archivesRes.events
                .slice(0, LOCAL_SEARCH_MAX_EVENTS)
                .map((event) => ({ event, source: 'archives' as const }))
              setArchivesRow({
                phase: 'done',
                hitCount: mergedHits.length,
                rawCount: archivesRes.total,
                ms: Math.round(performance.now() - t0Archives)
              })
              setHits(mergedHits)
              void addSearchEventsToSessionCacheBatched(
                mergedHits.map((h) => h.event),
                runGeneration,
                myRun
              )
            } else {
              setArchivesRow({
                phase: 'error',
                hitCount: 0,
                rawCount: 0,
                ms: Math.round(performance.now() - t0Archives),
                errorMessage: t('Full-text search archives unavailable')
              })
            }
          } catch {
            setArchivesRow({
              phase: 'error',
              hitCount: 0,
              rawCount: 0,
              ms: Math.round(performance.now() - t0Archives),
              errorMessage: t('Full-text search archives unavailable')
            })
          }
        }
      }
    })()

    return () => {
      runGeneration.current += 1
    }
  }, [q, kinds, archivesAvailable])

  if (!q) return null

  const loading =
    localRow?.phase === 'loading' || (archivesAvailable && archivesRow?.phase === 'loading')
  const done =
    localRow != null &&
    localRow.phase !== 'loading' &&
    (!archivesAvailable || (archivesRow != null && archivesRow.phase !== 'loading'))

  return (
    <div className="min-w-0 space-y-3" aria-busy={loading}>
      <p className="text-sm text-muted-foreground leading-snug">{t('Notes search local intro')}</p>

      {localRow ? (
        <section
          className="rounded-lg border border-border/60 bg-muted/20 text-xs"
          aria-label={t('Full-text search sources progress')}
          aria-busy={loading}
        >
          <ul className="divide-y divide-border/50">
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
          </ul>
        </section>
      ) : null}

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
                  hit.source === 'archives'
                    ? t('Full-text search archives description')
                    : t('Full-text search local archive description')
                }
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90 shrink-0">
                  {t('Full-text search seen on label')}
                </span>
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
          <p className="text-sm text-muted-foreground">{t('Full-text search empty local')}</p>
          {alexandriaEmptyHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaEmptyHref} /> : null}
        </div>
      )}
    </div>
  )
}
