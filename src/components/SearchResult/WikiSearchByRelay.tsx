import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { LIBRARY_RELAY_URLS } from '@/constants'
import { compareEventsForDTagQuery } from '@/lib/dtag-search'
import { queryIndexRelayWikiSearch } from '@/lib/index-relay-http'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { BookText, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** HTTP (Mercury-style) index relays from the library set that expose POST /api/wiki/search. */
const WIKI_SEARCH_HTTP_BASES = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))
const WIKI_SEARCH_LIMIT = 50

type Phase = 'idle' | 'loading' | 'done' | 'error'

/**
 * Dedicated NIP-54 wiki (kind 30818) results section for the generic Search page's FULL TEXT mode.
 *
 * Hits the Mercury relay's `POST /api/wiki/search` endpoint, which searches both the article body
 * and metadata tags (`d`, `title`, `summary`, `source`). Rendered alongside the broader NIP-50
 * full-text results in {@link SearchResult}. Hidden when there are no wiki hits to avoid clutter.
 */
export default function WikiSearchByRelay({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation()
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

    void (async () => {
      try {
        const byId = new Map<string, Event>()
        await Promise.all(
          WIKI_SEARCH_HTTP_BASES.map(async (base) => {
            try {
              const { events: evs } = await queryIndexRelayWikiSearch(base, q, {
                limit: WIKI_SEARCH_LIMIT,
                signal: abort.signal
              })
              for (const ev of evs) {
                if (!byId.has(ev.id)) byId.set(ev.id, ev)
              }
            } catch {
              // per-base best effort; other bases / sections still render
            }
          })
        )
        if (myRun !== runRef.current) return

        const merged = [...byId.values()].sort((a, b) => compareEventsForDTagQuery(q, a, b))
        for (const ev of merged) {
          client.addEventToCache(ev, { explicitNoteLookupHexId: ev.id })
        }
        setEvents(merged)
        setPhase('done')
      } catch {
        if (myRun !== runRef.current) return
        setPhase('error')
      }
    })()

    return () => abort.abort()
  }, [q])

  if (!q || phase === 'idle' || phase === 'error') return null
  // Don't show an empty Wikipedia block — the general full-text results cover the no-hit case.
  if (phase === 'done' && events.length === 0) return null

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
            <NoteCard
              event={event}
              className="w-full border-0 bg-transparent shadow-none"
              filterMutedNotes
              fetchNoteStatsIfMissing={false}
              deferAuthorAvatar
              searchListPreview
            />
          </article>
        ))}
      </div>
    </section>
  )
}
