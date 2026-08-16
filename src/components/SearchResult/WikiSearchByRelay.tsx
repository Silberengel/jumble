import WikiCard from '@/components/Note/WikiCard'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DOCUMENT_RELAY_URLS,
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  LIBRARY_RELAY_URLS
} from '@/constants'
import { compareEventsForDTagQuery } from '@/lib/dtag-search'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { eventMatchesGeneralSearchQuery } from '@/lib/general-search-text-match'
import {
  clearDevIndexRelayUnavailableThisSession,
  queryIndexRelayForLibrary,
  queryIndexRelayWikiSearch
} from '@/lib/index-relay-http'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'
import { normalizeAnyRelayUrl } from '@/lib/url'
import {
  planWikiSearchQuery,
  wikiEventMatchesSearchPlan,
  wikiIdentifierFiltersFromPlan
} from '@/lib/wiki-search-query'
import { indexSlug } from '@/lib/nip54'
import { useNostr } from '@/providers/NostrProvider'
import client, { queryService } from '@/services/client.service'
import { nip66Service } from '@/services/nip66.service'
import type { Event, Filter } from 'nostr-tools'
import { BookText, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** HTTP (Mercury-style) index relays: `/api/wiki/search` + `/api/events/filter`. */
const WIKI_SEARCH_HTTP_BASES = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))
const WIKI_SEARCH_LIMIT = 50
/** Coalesce streamed merges from the sources into at most one render per window. */
const WIKI_SEARCH_FLUSH_MS = 180

type Phase = 'idle' | 'loading' | 'done' | 'error'

/**
 * Dedicated NIP-54 wiki (kind 30818) results for Search (WIKI + FULL TEXT).
 *
 * Always runs local + HTTP API + WS relays in parallel (merge/dedupe):
 *   1. Local — session cache + IndexedDB
 *   2. Mercury HTTP — `POST /api/wiki/search` (text) and `POST /api/events/filter` (`#d` only)
 *   3. WS document/search relays — NIP-50 `search` + the same tag filters
 */
export default function WikiSearchByRelay({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation()
  const { relayList, cacheRelayListEvent } = useNostr()
  const q = searchQuery.trim()
  const runRef = useRef(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    const myRun = ++runRef.current
    if (!q) {
      setPhase('idle')
      setEvents([])
      return
    }

    setPhase('loading')
    setEvents([])
    // A prior hanging `#T`/`#i` filter may have marked the dev CORS proxy "down" for the tab;
    // give each wiki search a fresh chance at Mercury `#d` lookups.
    clearDevIndexRelayUnavailableThisSession()
    const abort = new AbortController()
    const plan = planWikiSearchQuery(q)
    const rankingQuery = plan.textQueries[0] || q

    const wsRelays = Array.from(
      new Set(
        [
          ...nip66Service.getSearchableRelayUrls(),
          ...DOCUMENT_RELAY_URLS,
          ...FAST_READ_RELAY_URLS,
          ...userReadInboxUrls(relayList, cacheRelayListEvent),
          ...userWriteOutboxUrls(relayList, cacheRelayListEvent)
        ]
          .map((u) => normalizeAnyRelayUrl(u) || '')
          .filter(Boolean)
      )
    )

    const resultMap = new Map<string, Event>()
    let flushTimer: number | null = null

    const flush = () => {
      if (myRun !== runRef.current) return
      setEvents(
        [...resultMap.values()].sort((a, b) => compareEventsForDTagQuery(rankingQuery, a, b))
      )
    }

    const scheduleFlush = () => {
      if (myRun !== runRef.current || flushTimer !== null) return
      flush()
      flushTimer = window.setTimeout(() => {
        flushTimer = null
        flush()
      }, WIKI_SEARCH_FLUSH_MS)
    }

    const merge = (incoming: Event[]) => {
      if (myRun !== runRef.current) return
      let added = false
      for (const ev of incoming) {
        if (ev.kind !== ExtendedKind.WIKI_ARTICLE || resultMap.has(ev.id)) continue
        resultMap.set(ev.id, ev)
        client.addEventToCache(ev, { explicitNoteLookupHexId: ev.id })
        added = true
      }
      if (added) scheduleFlush()
    }

    const mergeFiltered = (incoming: Event[]) => {
      merge(
        incoming.filter((ev) => wikiEventMatchesSearchPlan(ev, plan, eventMatchesGeneralSearchQuery))
      )
    }

    /** WS tag filters (NIP-50 `search` added separately). `#T` must be index_slug values. */
    const buildWsTagFilters = (): Filter[] => {
      const filters: Filter[] = []
      const tSlugs = new Set<string>()
      for (const title of plan.titleNeedles) {
        const slug = indexSlug(title)
        if (slug) tSlugs.add(slug)
      }
      for (const dTag of plan.dTags) {
        filters.push({ kinds: [ExtendedKind.WIKI_ARTICLE], '#d': [dTag], limit: WIKI_SEARCH_LIMIT })
        const slug = indexSlug(dTag)
        if (slug) tSlugs.add(slug)
      }
      for (const slug of tSlugs) {
        filters.push({
          kinds: [ExtendedKind.WIKI_ARTICLE],
          '#T': [slug],
          limit: WIKI_SEARCH_LIMIT
        } as Filter)
      }
      for (const filter of wikiIdentifierFiltersFromPlan(plan, WIKI_SEARCH_LIMIT)) {
        filters.push(filter)
      }
      return filters
    }

    /**
     * Mercury HTTP `/api/events/filter`: `#d` only.
     * `#T` / `#i` / `#s` often hang on this index (curl times out); a proxy 5xx then disables
     * further filter fetches for the whole dev session.
     */
    const buildHttpDTagFilters = (): Filter[] => {
      const dTags = new Set<string>(plan.dTags)
      for (const filter of wikiIdentifierFiltersFromPlan(plan, WIKI_SEARCH_LIMIT)) {
        const vals = (filter as { '#d'?: string[] })['#d']
        if (!vals?.length) continue
        for (const d of vals) dTags.add(d)
      }
      return [...dTags].map(
        (dTag) =>
          ({ kinds: [ExtendedKind.WIKI_ARTICLE], '#d': [dTag], limit: WIKI_SEARCH_LIMIT }) as Filter
      )
    }

    const fetchLocal = async () => {
      const queries = plan.textQueries.length > 0 ? plan.textQueries : [q]
      try {
        const batches = await Promise.all(
          queries.map((query) =>
            collectLocalEventsForTextSearch({
              query,
              allowedKinds: [ExtendedKind.WIKI_ARTICLE],
              sessionCap: 220,
              idbMergedLimit: 120,
              totalMaxMs: 8_000,
              archiveScanMaxMs: 6_000,
              publicationScanBudget: 6_000,
              publicationScanMaxMs: 6_000,
              fullTextScanMaxMs: 6_000,
              includeOtherStoresFullText: true,
              fullTextStoreHitCap: 200
            }).catch(() => [] as Event[])
          )
        )
        mergeFiltered(batches.flat())
      } catch {
        // best effort
      }
    }

    /** Mercury `POST /api/wiki/search` (full-text + metadata). Run in parallel with `#d`. */
    const fetchHttpWikiSearch = async () => {
      const queries = plan.textQueries.length > 0 ? plan.textQueries : [q]
      await Promise.all(
        WIKI_SEARCH_HTTP_BASES.flatMap((base) =>
          queries.map(async (query) => {
            try {
              const { events: evs } = await queryIndexRelayWikiSearch(base, query, {
                limit: WIKI_SEARCH_LIMIT,
                signal: abort.signal
              })
              merge(evs)
            } catch {
              // per-base best effort
            }
          })
        )
      )
    }

    /** Mercury `POST /api/events/filter` — `#d` only (see {@link buildHttpDTagFilters}). */
    const fetchHttpFilters = async () => {
      const filters = buildHttpDTagFilters()
      if (filters.length === 0 || WIKI_SEARCH_HTTP_BASES.length === 0) return
      await Promise.all(
        WIKI_SEARCH_HTTP_BASES.flatMap((base) =>
          filters.map(async (filter) => {
            try {
              const page = await queryIndexRelayForLibrary(base, filter, { signal: abort.signal })
              mergeFiltered((page.events as Event[]) ?? [])
            } catch {
              // per-filter best effort
            }
          })
        )
      )
    }

    /** WS relays: NIP-50 `search` + the same tag filters. */
    const fetchWs = async () => {
      if (wsRelays.length === 0) return
      const filters: Filter[] = [...buildWsTagFilters()]
      for (const text of plan.textQueries.length > 0 ? plan.textQueries : [q]) {
        filters.push({
          kinds: [ExtendedKind.WIKI_ARTICLE],
          search: text,
          limit: WIKI_SEARCH_LIMIT
        })
      }
      if (filters.length === 0) return
      try {
        const evs = await queryService.fetchEvents(wsRelays, filters, {
          firstRelayResultGraceMs: false,
          eoseTimeout: 4500,
          globalTimeout: 12_000
        })
        mergeFiltered(evs ?? [])
      } catch {
        // best effort
      }
    }

    void Promise.allSettled([
      fetchLocal(),
      fetchHttpWikiSearch(),
      fetchHttpFilters(),
      fetchWs()
    ]).then(() => {
      if (myRun !== runRef.current) return
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
        flushTimer = null
      }
      flush()
      setPhase('done')
    })

    return () => {
      abort.abort()
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
        flushTimer = null
      }
    }
  }, [q, relayList, cacheRelayListEvent])

  if (!q || phase === 'idle' || phase === 'error') return null
  if (events.length === 0 && phase === 'done') return null

  return (
    <section className="min-w-0 space-y-2" aria-label={t('Wiki search results')} aria-busy={phase === 'loading'}>
      <div className="flex items-center gap-2">
        <BookText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{t('Wiki')}</h3>
        {phase === 'loading' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('Full-text search source hits', { count: events.length })}
          </span>
        )}
      </div>

      {phase === 'loading' && events.length === 0 && (
        <div className="space-y-2" aria-label={t('Full-text search source loading')}>
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      <div className="min-w-0 space-y-2">
        {events.map((event) => (
          <article
            key={event.id}
            className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-border hover:bg-muted/15 hover:shadow-sm"
          >
            <WikiCard event={event} className="w-full border-0 bg-transparent shadow-none" />
          </article>
        ))}
      </div>
    </section>
  )
}
