import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import {
  createReactionDraftEvent,
  createWikiArticleDraftEvent,
  createWikiMergeAcceptanceDraftEvent
} from '@/lib/draft-event'
import {
  getReplaceableCoordinateFromEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { parseWikiMergeRequest } from '@/lib/nip54'
import { showPublishingError } from '@/lib/publishing-feedback'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import client, { queryService } from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

async function buildBaseRelayUrls(
  event: Event,
  userRead: string[],
  userWrite: string[],
  extraPubkeys: string[]
): Promise<string[]> {
  const urls = new Set<string>(
    [
      ...FAST_READ_RELAY_URLS,
      ...userRead,
      ...userWrite,
      ...relayHintsFromEventTags(event),
      ...client.getSeenEventRelayUrls(event.id)
    ]
      .map((url) => normalizeAnyRelayUrl(url) || '')
      .filter(Boolean)
  )
  for (const pubkey of extraPubkeys) {
    try {
      const list = await client.fetchRelayList(pubkey)
      ;[
        ...(list?.httpRead ?? []),
        ...(list?.read ?? []),
        ...(list?.httpWrite ?? []),
        ...(list?.write ?? [])
      ].forEach((url) => {
        const u = normalizeAnyRelayUrl(url)
        if (u) urls.add(u)
      })
    } catch {
      // keep what we have
    }
  }
  return Array.from(urls)
}

/** Latest-per-pubkey wins for addressable-ish dedupe; keep newest first. */
function dedupeNewest(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const e of events) byId.set(e.id, e)
  return Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at)
}

/**
 * Fetch kind:818 merge requests that target a wiki article (`#a` = its coordinate).
 * Only meaningful for kind:30818 events.
 */
export function useFetchWikiMergeRequests(article: Event | undefined) {
  const { relayList, cacheRelayListEvent } = useNostr()
  const [mergeRequests, setMergeRequests] = useState<Event[]>([])
  const [isFetching, setIsFetching] = useState(false)

  const coordinate = useMemo(
    () =>
      article && article.kind === ExtendedKind.WIKI_ARTICLE
        ? normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(article))
        : undefined,
    [article]
  )

  useEffect(() => {
    if (!article || !coordinate) {
      setMergeRequests([])
      return
    }
    let cancelled = false
    setIsFetching(true)
    const userRead = userReadInboxUrls(relayList, cacheRelayListEvent)
    const userWrite = userWriteOutboxUrls(relayList, cacheRelayListEvent)

    void (async () => {
      try {
        const baseUrls = await buildBaseRelayUrls(article, userRead, userWrite, [article.pubkey])
        if (cancelled) return
        const events = await queryService.fetchEvents(
          baseUrls,
          [{ kinds: [ExtendedKind.WIKI_MERGE_REQUEST], '#a': [coordinate], limit: 200 }],
          { firstRelayResultGraceMs: false, eoseTimeout: 4500, globalTimeout: 24_000 }
        )
        if (cancelled) return
        setMergeRequests(
          dedupeNewest((events ?? []).filter((e) => e.kind === ExtendedKind.WIKI_MERGE_REQUEST))
        )
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    })()

    const handler = (e: CustomEvent<Event>) => {
      const ev = e.detail
      if (ev.kind !== ExtendedKind.WIKI_MERGE_REQUEST) return
      const parsed = parseWikiMergeRequest(ev)
      if (
        parsed?.destinationCoordinate &&
        normalizeReplaceableCoordinateString(parsed.destinationCoordinate) === coordinate
      ) {
        setMergeRequests((prev) => dedupeNewest([ev, ...prev]))
      }
    }
    client.addEventListener('newEvent', handler as EventListener)
    return () => {
      cancelled = true
      client.removeEventListener('newEvent', handler as EventListener)
    }
  }, [article, coordinate, relayList, cacheRelayListEvent])

  return { mergeRequests, isFetching }
}

export type WikiMergeStatus = {
  /** kind:819 acceptances of this merge request. */
  acceptances: Event[]
  /** NIP-25 reactions (kind 7) on this merge request. */
  reactions: Event[]
  isFetching: boolean
}

/**
 * Fetch acceptance signals for a kind:818 merge request: kind:819 acceptances and NIP-25
 * reactions (both reference the request via `#e`).
 */
export function useFetchWikiMergeStatus(mergeRequest: Event | undefined): WikiMergeStatus {
  const { relayList, cacheRelayListEvent } = useNostr()
  const [acceptances, setAcceptances] = useState<Event[]>([])
  const [reactions, setReactions] = useState<Event[]>([])
  const [isFetching, setIsFetching] = useState(false)

  const mrId = mergeRequest?.kind === ExtendedKind.WIKI_MERGE_REQUEST ? mergeRequest.id : undefined

  useEffect(() => {
    if (!mergeRequest || !mrId) {
      setAcceptances([])
      setReactions([])
      return
    }
    let cancelled = false
    setIsFetching(true)
    const userRead = userReadInboxUrls(relayList, cacheRelayListEvent)
    const userWrite = userWriteOutboxUrls(relayList, cacheRelayListEvent)
    const parsed = parseWikiMergeRequest(mergeRequest)
    const extraPubkeys = [mergeRequest.pubkey, parsed?.destinationPubkey].filter(
      (p): p is string => !!p
    )

    void (async () => {
      try {
        const baseUrls = await buildBaseRelayUrls(mergeRequest, userRead, userWrite, extraPubkeys)
        if (cancelled) return
        const events = await queryService.fetchEvents(
          baseUrls,
          [
            { kinds: [ExtendedKind.WIKI_MERGE_ACCEPTANCE], '#e': [mrId], limit: 100 },
            { kinds: [kinds.Reaction], '#e': [mrId], limit: 200 }
          ],
          { firstRelayResultGraceMs: false, eoseTimeout: 4500, globalTimeout: 24_000 }
        )
        if (cancelled) return
        const all = events ?? []
        setAcceptances(
          dedupeNewest(all.filter((e) => e.kind === ExtendedKind.WIKI_MERGE_ACCEPTANCE))
        )
        setReactions(dedupeNewest(all.filter((e) => e.kind === kinds.Reaction)))
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    })()

    const handler = (e: CustomEvent<Event>) => {
      const ev = e.detail
      const refsMr = ev.tags.some((t) => t[0] === 'e' && t[1] === mrId)
      if (!refsMr) return
      if (ev.kind === ExtendedKind.WIKI_MERGE_ACCEPTANCE) {
        setAcceptances((prev) => dedupeNewest([ev, ...prev]))
      } else if (ev.kind === kinds.Reaction) {
        setReactions((prev) => dedupeNewest([ev, ...prev]))
      }
    }
    client.addEventListener('newEvent', handler as EventListener)
    return () => {
      cancelled = true
      client.removeEventListener('newEvent', handler as EventListener)
    }
  }, [mergeRequest, mrId, relayList, cacheRelayListEvent])

  return { acceptances, reactions, isFetching }
}

/** Accept or reject a kind:818 merge request (destination article owner). */
export function useWikiMergeReviewActions(mergeRequest: Event) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const [busy, setBusy] = useState(false)
  const [localResolution, setLocalResolution] = useState<'merged' | 'rejected' | null>(null)
  const mr = useMemo(() => parseWikiMergeRequest(mergeRequest), [mergeRequest])

  const reject = useCallback(() => {
    checkLogin(async () => {
      setBusy(true)
      setLocalResolution('rejected')
      try {
        await publish(createReactionDraftEvent(mergeRequest, '-'), {
          addClientTag: storage.getAddClientTag()
        })
        toast.success(t('Merge request rejected'))
      } catch (err) {
        setLocalResolution(null)
        showPublishingError(err as Error)
      } finally {
        setBusy(false)
      }
    })
  }, [checkLogin, mergeRequest, publish, t])

  const accept = useCallback(() => {
    checkLogin(async () => {
      if (!mr?.forkEventId || !mr.destinationCoordinate) {
        toast.error(t('This merge request is incomplete.'))
        return
      }
      const dTag = mr.destinationCoordinate.split(':').slice(2).join(':')
      if (!dTag) {
        toast.error(t('This merge request is incomplete.'))
        return
      }
      setBusy(true)
      setLocalResolution('merged')
      try {
        const fork = await client.fetchEvent(mr.forkEventId)
        if (!fork) {
          toast.error(t('Could not load the proposed version.'))
          return
        }
        const forkMeta = getLongFormArticleMetadataFromEvent(fork)
        const mergedDraft = await createWikiArticleDraftEvent(fork.content, [], {
          dTag,
          title: forkMeta.title || undefined,
          summary: forkMeta.summary || undefined,
          image: forkMeta.image || undefined,
          topics: forkMeta.tags
        })
        const mergedVersion = await publish(mergedDraft, {
          addClientTag: storage.getAddClientTag()
        })
        await publish(createWikiMergeAcceptanceDraftEvent(mergeRequest, mergedVersion), {
          addClientTag: storage.getAddClientTag()
        })
        await publish(createReactionDraftEvent(mergeRequest, '+'), {
          addClientTag: storage.getAddClientTag()
        })
        toast.success(t('Merge request accepted'))
      } catch (err) {
        setLocalResolution(null)
        showPublishingError(err as Error)
      } finally {
        setBusy(false)
      }
    })
  }, [checkLogin, mergeRequest, mr, publish, t])

  return { mr, busy, reject, accept, localResolution }
}
