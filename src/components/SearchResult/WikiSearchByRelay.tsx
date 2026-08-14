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
import { expandIdentifier } from '@/lib/identifier-expander'
import { queryIndexRelayWikiSearch } from '@/lib/index-relay-http'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'
import { normalizeWikiDTag } from '@/lib/nip54'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import client, { queryService } from '@/services/client.service'
import { nip66Service } from '@/services/nip66.service'
import type { Event, Filter } from 'nostr-tools'
import { BookText, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** HTTP (Mercury-style) index relays from the library set that expose POST /api/wiki/search. */
const WIKI_SEARCH_HTTP_BASES = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))
const WIKI_SEARCH_LIMIT = 50
/** Coalesce streamed merges from the three sources into at most one render per window. */
const WIKI_SEARCH_FLUSH_MS = 180

type Phase = 'idle' | 'loading' | 'done' | 'error'

/**
 * Dedicated NIP-54 wiki (kind 30818) results section for the generic Search page's FULL TEXT mode.
 *
 * Always runs Mercury HTTP and WS/document-relay tag filters in parallel (merge/dedupe) — never
 * Mercury-only-then-fallback:
 *   1. Local — session cache + IndexedDB stores
 *   2. Mercury HTTP — `POST /api/wiki/search`
 *   3. Relays — NIP-50 `search`, exact `#d`, plus `#T` / `#i` / `#s` from the identifier expander
 *
 * Opens articles with the event already in hand (WikiCard → note route).
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
    const abort = new AbortController()
    const dTag = normalizeWikiDTag(q)
    const expanded = expandIdentifier(q)

    // WebSocket relays worth a NIP-50 / tag REQ for wiki articles: NIP-50-capable relays plus the
    // document/library relays, the viewer's own inboxes/outboxes, and fast read defaults.
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

    // Shared streaming merge map: every source folds its hits in here, deduped by id and re-sorted by
    // relevance to the query, then flushed (throttled) so the list grows as sources resolve.
    const resultMap = new Map<string, Event>()
    let flushTimer: number | null = null

    const flush = () => {
      if (myRun !== runRef.current) return
      setEvents([...resultMap.values()].sort((a, b) => compareEventsForDTagQuery(q, a, b)))
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

    /** Local session cache + IndexedDB stores; renders before any network round-trip. */
    const fetchLocal = async () => {
      try {
        const local = await collectLocalEventsForTextSearch({
          query: q,
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
        })
        merge(local)
      } catch {
        // best effort; remote sources still render
      }
    }

    /** Mercury HTTP `/api/wiki/search` (body + metadata, server-ranked) — always in parallel with WS. */
    const fetchHttp = async () => {
      await Promise.all(
        WIKI_SEARCH_HTTP_BASES.map(async (base) => {
          try {
            const { events: evs } = await queryIndexRelayWikiSearch(base, q, {
              limit: WIKI_SEARCH_LIMIT,
              signal: abort.signal
            })
            merge(evs)
          } catch {
            // per-base best effort; other bases / sources still render
          }
        })
      )
    }

    /**
     * WS NIP-50 `search` + exact `#d` + catalog `#T` / `#i` / `#s` (never `#title`).
     * Always runs alongside Mercury — merge/dedupe; never Mercury-only-then-fallback.
     */
    const fetchWs = async () => {
      if (wsRelays.length === 0) return
      const filters: Filter[] = [
        { kinds: [ExtendedKind.WIKI_ARTICLE], search: q, limit: WIKI_SEARCH_LIMIT },
        { kinds: [ExtendedKind.WIKI_ARTICLE], '#T': [q], limit: WIKI_SEARCH_LIMIT } as Filter
      ]
      if (dTag) {
        filters.push({ kinds: [ExtendedKind.WIKI_ARTICLE], '#d': [dTag], limit: WIKI_SEARCH_LIMIT })
        filters.push({
          kinds: [ExtendedKind.WIKI_ARTICLE],
          '#T': [dTag],
          limit: WIKI_SEARCH_LIMIT
        } as Filter)
      }
      if (expanded.i?.length) {
        filters.push({
          kinds: [ExtendedKind.WIKI_ARTICLE],
          '#i': expanded.i,
          limit: WIKI_SEARCH_LIMIT
        } as Filter)
      }
      if (expanded.s?.length) {
        filters.push({
          kinds: [ExtendedKind.WIKI_ARTICLE],
          '#s': expanded.s,
          limit: WIKI_SEARCH_LIMIT
        } as Filter)
      }
      try {
        const evs = await queryService.fetchEvents(wsRelays, filters, {
          firstRelayResultGraceMs: false,
          eoseTimeout: 4500,
          globalTimeout: 12_000
        })
        // Relays that ignore NIP-50 `search` return recent articles instead — keep only true matches
        // (exact `#d` / identifier / title-tag hits always count even if the body text differs).
        merge(
          (evs ?? []).filter((ev) => {
            if (ev.kind !== ExtendedKind.WIKI_ARTICLE) return false
            if (eventMatchesGeneralSearchQuery(ev, q)) return true
            if (dTag && ev.tags.some((tg) => tg[0] === 'd' && tg[1] === dTag)) return true
            if (expanded.i?.some((id) => ev.tags.some((tg) => tg[0] === 'i' && tg[1] === id))) {
              return true
            }
            if (expanded.s?.some((src) => ev.tags.some((tg) => tg[0] === 's' && tg[1] === src))) {
              return true
            }
            if (
              ev.tags.some(
                (tg) =>
                  (tg[0] === 'T' || tg[0] === 'title') &&
                  typeof tg[1] === 'string' &&
                  tg[1].toLowerCase().includes(q.toLowerCase())
              )
            ) {
              return true
            }
            return false
          })
        )
      } catch {
        // best effort; local / http sources still render
      }
    }

    void Promise.allSettled([fetchLocal(), fetchHttp(), fetchWs()]).then(() => {
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
  // Don't show an empty Wiki block while still loading with nothing yet, or after a no-hit search —
  // the general full-text results cover the no-hit case.
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
