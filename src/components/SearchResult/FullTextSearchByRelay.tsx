import NoteCard from '@/components/NoteCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { compareEventsForDTagQuery } from '@/lib/dtag-search'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { relayHostForSubscribeLog } from '@/services/relay-operation-log.service'
import type { Event, Filter } from 'nostr-tools'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** One-shot NIP-50 REQ per relay; bounded wait so the page always reaches a terminal state. */
const FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS = 10_000
/** Avoid opening every index relay at once (pool + main thread); still completes all relays. */
const FULL_TEXT_SEARCH_RELAY_CONCURRENCY = 3
const FULL_TEXT_SEARCH_PER_RELAY_LIMIT = 80
/** Cap rows per card so a hot relay cannot mount hundreds of {@link NoteCard}s at once. */
const FULL_TEXT_SEARCH_MAX_NOTES_PER_RELAY = 40

type RelayCardPhase = 'loading' | 'done' | 'error'

type RelayCardModel = {
  relayUrl: string
  host: string
  phase: RelayCardPhase
  events: Event[]
  ms?: number
  errorMessage?: string
}

function normalizeRelayList(urls: readonly string[]): string[] {
  return Array.from(
    new Set(urls.map((u) => normalizeUrl(u) || u.trim()).filter((u): u is string => u.length > 0))
  ).sort((a, b) => relayHostForSubscribeLog(a).localeCompare(relayHostForSubscribeLog(b)))
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
  const [cards, setCards] = useState<RelayCardModel[]>([])

  const normalizedRelays = useMemo(() => normalizeRelayList(relayUrls), [relayUrls])

  const q = searchQuery.trim()
  const timeoutSec = Math.round(FULL_TEXT_SEARCH_PER_RELAY_TIMEOUT_MS / 1000)

  useEffect(() => {
    const myRun = ++runGeneration.current
    if (!q || normalizedRelays.length === 0) {
      setCards([])
      return
    }

    /** React 18 Strict Mode (dev) mounts twice; bump invalidates the previous run’s workers and ignores stale fetches. */
    const cleanupInvalidatePreviousRun = () => {
      runGeneration.current += 1
    }

    const filter: Filter = {
      search: q,
      kinds: [...kinds],
      limit: FULL_TEXT_SEARCH_PER_RELAY_LIMIT
    }

    const poolSize = Math.min(FULL_TEXT_SEARCH_RELAY_CONCURRENCY, normalizedRelays.length)

    setCards(
      normalizedRelays.map((relayUrl) => ({
        relayUrl,
        host: relayHostForSubscribeLog(relayUrl),
        phase: 'loading',
        events: []
      }))
    )

    let relayCursor = 0
    const nextRelayUrl = (): string | undefined => {
      if (relayCursor >= normalizedRelays.length) return undefined
      return normalizedRelays[relayCursor++]!
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

        const sorted = [...raw].sort((a, b) => compareEventsForDTagQuery(q, a, b)).slice(0, FULL_TEXT_SEARCH_MAX_NOTES_PER_RELAY)
        for (const e of sorted) {
          client.addEventToCache(e, { explicitNoteLookupHexId: e.id })
        }

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
          setCards((prev) =>
            prev.map((c) =>
              c.relayUrl === relayUrl
                ? {
                    ...c,
                    phase: 'error',
                    events: [],
                    ms,
                    errorMessage: connectionError
                  }
                : c
            )
          )
          return
        }

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

        setCards((prev) =>
          prev.map((c) =>
            c.relayUrl === relayUrl
              ? {
                  ...c,
                  phase: 'done',
                  events: sorted,
                  ms,
                  errorMessage: sorted.length > 0 ? undefined : connectionError
                }
              : c
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
        setCards((prev) =>
          prev.map((c) =>
            c.relayUrl === relayUrl
              ? {
                  ...c,
                  phase: 'error',
                  events: [],
                  ms,
                  errorMessage: msg
                }
              : c
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
        /* runOneRelay already updates card errors */
      }
      if (myRun !== runGeneration.current) return
      logger.debug('[NIP-50 full-text] wave_end', {
        runId: myRun,
        relayCount: normalizedRelays.length,
        note: 'matches UI "all relays finished" when every card is done or error'
      })
    })()

    return cleanupInvalidatePreviousRun
  }, [q, normalizedRelays, kinds])

  const allTerminal =
    cards.length > 0 && cards.every((c) => c.phase === 'done' || c.phase === 'error')
  const anyLoading = cards.some((c) => c.phase === 'loading')

  if (!q) {
    return null
  }

  return (
    <div className="min-w-0 space-y-4" aria-busy={anyLoading}>
      <p className="text-sm text-muted-foreground">
        {t('Full-text search per relay intro', {
          relayCount: normalizedRelays.length,
          seconds: timeoutSec,
          concurrency: FULL_TEXT_SEARCH_RELAY_CONCURRENCY
        })}
      </p>

      <div
        className={cn(
          'grid gap-4 min-w-0',
          'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
        )}
      >
        {cards.map((c) => (
          <Card key={c.relayUrl} className="min-w-0 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base font-medium break-all">{c.host}</CardTitle>
                {c.phase === 'loading' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    {c.events.length}
                  </Badge>
                )}
              </div>
              <CardDescription className="break-all text-xs font-mono opacity-80">{c.relayUrl}</CardDescription>
              {c.phase === 'done' && c.ms != null && (
                <p className="text-xs text-muted-foreground">
                  {t('Full-text search relay timing', { ms: c.ms })}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pt-0 flex flex-col gap-2">
              {c.phase === 'loading' && (
                <div className="space-y-2" aria-label={t('Full-text search relay querying')}>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}
              {c.phase === 'error' && (
                <p className="text-sm text-destructive">
                  {t('Full-text search relay error')}: {c.errorMessage ?? t('Full-text search relay unknown error')}
                </p>
              )}
              {c.phase === 'done' && c.events.length === 0 && !c.errorMessage && (
                <p className="text-sm text-muted-foreground">{t('Full-text search relay no hits')}</p>
              )}
              {c.phase === 'done' && c.events.length === 0 && c.errorMessage && (
                <p className="text-sm text-muted-foreground">{c.errorMessage}</p>
              )}
              {c.events.length > 0 && (
                <ul
                  className="max-h-[min(28rem,55vh)] overflow-y-auto space-y-3 pr-1 -mr-1 min-w-0"
                  role="list"
                >
                  {c.events.map((ev) => (
                    <li key={ev.id} className="min-w-0">
                      <NoteCard event={ev} className="w-full" filterMutedNotes />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {allTerminal && (
        <p className="text-sm text-muted-foreground border-t pt-3" role="status">
          {t('Full-text search all relays finished')}
        </p>
      )}
    </div>
  )
}
