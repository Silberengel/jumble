import {
  dedupeCalendarEventsPreferringOccurrenceRange,
  nip52UtcDayIndicesForLocalRange
} from '@/lib/calendar-event'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import type { Event as NostrEvent } from 'nostr-tools'

const FOLLOWING_CALENDAR_AUTHORS_CAP = 200
const FOLLOWING_CALENDAR_AUTHORS_CHUNK = 80
const FOLLOWING_CALENDAR_CHUNK_LIMIT = 350
const LATE_SESSION_MERGE_MS = 2500

export type CalendarFeedLoadOptions = {
  relayUrls: readonly string[]
  rangeStartMs: number
  rangeEndExclusiveMs: number
  followAuthorsKey: string
  fetchLimit: number
  sessionMergeCap: number
  idbMaxScan: number
  archiveMaxScan: number
  archiveMaxMatches: number
  mainFetchGlobalTimeout: number
  mainFetchEoseTimeout: number
  chunkFetchGlobalTimeout: number
  chunkFetchEoseTimeout: number
  isStale: () => boolean
  onReplace: (events: NostrEvent[]) => void
  onMerge: (events: NostrEvent[]) => void
}

function sessionCalendarEvents(cap: number): NostrEvent[] {
  return client.getSessionEventsMatchingSearch('', cap, [...CALENDAR_EVENT_KINDS])
}

function dedupeForRange(events: NostrEvent[], rangeStartMs: number, rangeEndExclusiveMs: number) {
  return dedupeCalendarEventsPreferringOccurrenceRange(events, rangeStartMs, rangeEndExclusiveMs)
}

function authorChunks(followAuthorsKey: string): string[][] {
  const authorList = followAuthorsKey
    ? followAuthorsKey.split('|').filter(Boolean).slice(0, FOLLOWING_CALENDAR_AUTHORS_CAP)
    : []
  const chunks: string[][] = []
  for (let i = 0; i < authorList.length; i += FOLLOWING_CALENDAR_AUTHORS_CHUNK) {
    chunks.push(authorList.slice(i, i + FOLLOWING_CALENDAR_AUTHORS_CHUNK))
  }
  return chunks
}

async function fetchCalendarFromRelays(
  relayUrls: readonly string[],
  rangeStartMs: number,
  rangeEndExclusiveMs: number,
  followAuthorsKey: string,
  fetchLimit: number,
  mainFetchGlobalTimeout: number,
  mainFetchEoseTimeout: number,
  chunkFetchGlobalTimeout: number,
  chunkFetchEoseTimeout: number
): Promise<{ batch: NostrEvent[]; fromFollowing: NostrEvent[] }> {
  if (!relayUrls.length) {
    return { batch: [], fromFollowing: [] }
  }

  const mainFetchOpts = {
    cache: true as const,
    globalTimeout: mainFetchGlobalTimeout,
    eoseTimeout: mainFetchEoseTimeout,
    firstRelayResultGraceMs: false as const
  }
  const chunkFetchOpts = {
    cache: true as const,
    globalTimeout: chunkFetchGlobalTimeout,
    eoseTimeout: chunkFetchEoseTimeout,
    firstRelayResultGraceMs: false as const
  }

  const dayIndices = nip52UtcDayIndicesForLocalRange(rangeStartMs, rangeEndExclusiveMs)
  const dayScopedReq =
    dayIndices.length > 0
      ? client.fetchEvents(
          [...relayUrls],
          {
            kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
            '#D': dayIndices,
            limit: fetchLimit
          },
          mainFetchOpts
        )
      : Promise.resolve([] as NostrEvent[])

  const broadReq = client.fetchEvents(
    [...relayUrls],
    {
      kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
      limit: fetchLimit
    },
    mainFetchOpts
  )

  const chunks = authorChunks(followAuthorsKey)
  const chunkReqs = chunks.map((authors) =>
    client.fetchEvents(
      [...relayUrls],
      {
        kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
        authors,
        limit: FOLLOWING_CALENDAR_CHUNK_LIMIT
      },
      chunkFetchOpts
    )
  )

  try {
    const merged = await Promise.all([dayScopedReq, broadReq, ...chunkReqs])
    const fromDayScoped = merged[0] ?? []
    const fromBroad = merged[1] ?? []
    const fromFollowing: NostrEvent[] = []
    for (let i = 2; i < merged.length; i++) {
      fromFollowing.push(...(merged[i] ?? []))
    }
    return { batch: [...fromDayScoped, ...fromBroad], fromFollowing }
  } catch {
    return { batch: [], fromFollowing: [] }
  }
}

async function loadLocalCalendarBaseline(
  rangeStartMs: number,
  rangeEndExclusiveMs: number,
  idbMaxScan: number,
  archiveMaxScan: number,
  archiveMaxMatches: number
): Promise<NostrEvent[]> {
  try {
    const [fromIdb, fromArchive] = await Promise.all([
      indexedDb.getCalendarEventsForOccurrenceWindow(rangeStartMs, rangeEndExclusiveMs, idbMaxScan),
      indexedDb.getArchivedCalendarEventsOverlappingWindow(
        rangeStartMs,
        rangeEndExclusiveMs,
        archiveMaxScan,
        archiveMaxMatches
      )
    ])
    return dedupeForRange([...fromIdb, ...fromArchive], rangeStartMs, rangeEndExclusiveMs)
  } catch {
    return []
  }
}

/**
 * Load calendar events for a local time window: session + IndexedDB paint immediately; relays merge when ready.
 * Returns a cleanup function (cancel in-flight work + late session merge timer).
 */
export function startCalendarFeedLoad(options: CalendarFeedLoadOptions): () => void {
  const {
    relayUrls,
    rangeStartMs,
    rangeEndExclusiveMs,
    followAuthorsKey,
    fetchLimit,
    sessionMergeCap,
    idbMaxScan,
    archiveMaxScan,
    archiveMaxMatches,
    mainFetchGlobalTimeout,
    mainFetchEoseTimeout,
    chunkFetchGlobalTimeout,
    chunkFetchEoseTimeout,
    isStale,
    onReplace,
    onMerge
  } = options

  let lateMergeTimer: number | null = null

  const scheduleLateSessionMerge = () => {
    lateMergeTimer = window.setTimeout(() => {
      lateMergeTimer = null
      if (isStale()) return
      onMerge(sessionCalendarEvents(sessionMergeCap))
    }, LATE_SESSION_MERGE_MS)
  }

  onReplace(
    dedupeForRange(sessionCalendarEvents(sessionMergeCap), rangeStartMs, rangeEndExclusiveMs)
  )

  void (async () => {
    const localBaselineP = loadLocalCalendarBaseline(
      rangeStartMs,
      rangeEndExclusiveMs,
      idbMaxScan,
      archiveMaxScan,
      archiveMaxMatches
    )

    localBaselineP.then((localBaseline) => {
      if (isStale() || localBaseline.length === 0) return
      onMerge([...localBaseline, ...sessionCalendarEvents(sessionMergeCap)])
    })

    try {
      if (!relayUrls.length) {
        const localBaseline = await localBaselineP
        if (isStale()) return
        onReplace([...localBaseline, ...sessionCalendarEvents(sessionMergeCap)])
        scheduleLateSessionMerge()
        return
      }

      const relayMergedP = fetchCalendarFromRelays(
        relayUrls,
        rangeStartMs,
        rangeEndExclusiveMs,
        followAuthorsKey,
        fetchLimit,
        mainFetchGlobalTimeout,
        mainFetchEoseTimeout,
        chunkFetchGlobalTimeout,
        chunkFetchEoseTimeout
      )

      const [{ batch, fromFollowing }, localBaseline] = await Promise.all([relayMergedP, localBaselineP])
      if (isStale()) return

      onReplace([
        ...localBaseline,
        ...sessionCalendarEvents(sessionMergeCap),
        ...batch,
        ...fromFollowing
      ])
      scheduleLateSessionMerge()
    } catch {
      if (isStale()) return
      try {
        const localBaseline = await loadLocalCalendarBaseline(
          rangeStartMs,
          rangeEndExclusiveMs,
          idbMaxScan,
          archiveMaxScan,
          archiveMaxMatches
        )
        onReplace([...localBaseline, ...sessionCalendarEvents(sessionMergeCap)])
      } catch {
        onReplace([])
      }
    }
  })()

  return () => {
    if (lateMergeTimer != null) window.clearTimeout(lateMergeTimer)
  }
}
