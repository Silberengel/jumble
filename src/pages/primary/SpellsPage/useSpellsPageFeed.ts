import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event } from 'nostr-tools'
import { kinds as nostrKinds } from 'nostr-tools'
import { ExtendedKind, DEFAULT_FEED_SHOW_KINDS } from '@/constants'
import { getPubkeysFromPTags } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import {
  augmentSubRequestsWithFavoritesFastReadAndInbox,
  getRelayUrlsWithFavoritesFastReadAndInbox,
  userReadRelaysWithHttp
} from '@/lib/favorites-feed-relays'
import {
  computeKind777SpellFeedSubscriptionKey,
  computeSpellSubRequestsIdentityKey
} from '@/lib/spell-feed-request-identity'
import { isUserInEventMentions } from '@/lib/event'
import {
  decodeFollowSetSpellId,
  getFollowSetDTag,
  isFollowSetSpellId,
  pubkeysFromFollowSetEvent
} from '@/lib/follow-set-spell'
import client from '@/services/client.service'
import {
  buildBookmarksSubRequests,
  buildCalendarSpellFilter,
  buildDiscussionFilter,
  buildInterestsSubRequests,
  buildMediaSpellFilter,
  buildNotificationsSpellSubRequests,
  buildWebBookmarksSpellSubRequests,
  NOTIFICATION_SPELL_LOADING_SAFETY_MS,
  FAUX_SPELL_EVENT_LIMIT,
  MEDIA_SPELL_KINDS,
  NOTIFICATION_SPELL_KINDS,
  applyFauxSpellCapsToSubRequests,
  ensureFauxSpellRelayStackTouchesFastRead
} from './fauxSpellFeeds'
import { getRelaysForSpell, spellEventToFilter } from '@/services/spell.service'
import type { TFeedSubRequest } from '@/types'
import { isFollowFeedFauxSpellId } from './fauxSpellConfig'
import storage from '@/services/local-storage.service'

/** `fetchReplaceableEvent(kind 3)` / relay-list hydration can hang; never block the Following spell on it. */
const FOLLOWING_FETCH_FOLLOWINGS_TIMEOUT_MS = 10_000
/** Per-shard relay-list batch has a UI budget; still cap so a wedged promise cannot blank the feed forever. */
const FOLLOWING_GENERATE_SUBREQ_TIMEOUT_MS = 16_000
const FOLLOWING_INBOX_SHARD_AUTHOR_CAP = 512

function racePromiseWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(onTimeout()), ms)
    promise
      .then((v) => {
        window.clearTimeout(t)
        resolve(v)
      })
      .catch(() => {
        window.clearTimeout(t)
        resolve(onTimeout())
      })
  })
}

function buildInboxShardFollowingSubRequests(args: {
  authors: string[]
  favoriteRelays: string[]
  blockedRelays: string[]
  relayList: { read: string[]; write: string[] } | null | undefined
  augment: (raw: TFeedSubRequest[]) => TFeedSubRequest[]
}): TFeedSubRequest[] {
  const { authors, favoriteRelays, blockedRelays, relayList, augment } = args
  const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
    favoriteRelays,
    blockedRelays,
    userReadRelaysWithHttp(relayList),
    { userWriteRelays: relayList?.write ?? [] }
  )
  if (!feedUrls.length) return []
  const capped = authors.slice(0, FOLLOWING_INBOX_SHARD_AUTHOR_CAP)
  return augment([
    {
      urls: feedUrls,
      filter: {
        authors: capped,
        kinds: [...DEFAULT_FEED_SHOW_KINDS],
        limit: FAUX_SPELL_EVENT_LIMIT
      }
    }
  ])
}

function useNoteListHideReplies() {
  const [hideReplies, setHideReplies] = useState(() => storage.getNoteListMode() === 'posts')

  useEffect(() => {
    const sync = () => setHideReplies(storage.getNoteListMode() === 'posts')
    window.addEventListener('noteListModeChanged', sync)
    return () => window.removeEventListener('noteListModeChanged', sync)
  }, [])

  return hideReplies
}

export type UseSpellsPageFeedArgs = {
  selectedFauxSpell: string | null
  selectedSpell: Event | null
  pubkey: string | null | undefined
  relayList: { read: string[]; write: string[] } | null | undefined
  favoriteRelays: string[]
  blockedRelays: string[]
  notificationsFeedPubkey: string | null
  interestListEvent: Event | null | undefined
  bookmarkListEvent: Event | null | undefined
  followListEvent: Event | null | undefined
  contacts: string[]
  contactsSyncKey: string
  followSetListEvents: Event[]
  followSetCatalogLoading: boolean
  kindFilterShowKinds: number[]
}

export function useSpellsPageFeed(a: UseSpellsPageFeedArgs) {
  const {
    selectedFauxSpell,
    selectedSpell,
    pubkey,
    relayList,
    favoriteRelays,
    blockedRelays,
    notificationsFeedPubkey,
    interestListEvent,
    bookmarkListEvent,
    followListEvent,
    contacts,
    contactsSyncKey,
    followSetListEvents,
    followSetCatalogLoading,
    kindFilterShowKinds
  } = a

  const hideRepliesFollowing = useNoteListHideReplies()
  const [followingSubRequests, setFollowingSubRequests] = useState<TFeedSubRequest[]>([])

  const normalizedReadSorted = relayList
    ? [...relayList.read].map((u) => normalizeUrl(u) || u).filter(Boolean).sort()
    : []
  const normalizedWriteSorted = relayList
    ? [...relayList.write].map((u) => normalizeUrl(u) || u).filter(Boolean).sort()
    : []

  const relayMailboxStableKey =
    relayList == null
      ? ''
      : JSON.stringify({ r: normalizedReadSorted, w: normalizedWriteSorted })

  const relayListWriteKey = useMemo(() => {
    if (!relayList) return '[]'
    return JSON.stringify(normalizedWriteSorted)
  }, [relayMailboxStableKey])

  const sortedFavoriteRelaysKey = useMemo(
    () =>
      JSON.stringify(
        [...favoriteRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort((x, y) => x.localeCompare(y))
      ),
    [favoriteRelays]
  )
  const sortedBlockedRelaysKey = useMemo(
    () =>
      JSON.stringify(
        [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort((x, y) => x.localeCompare(y))
      ),
    [blockedRelays]
  )

  const followSetListStableKey = useMemo(
    () =>
      followSetListEvents
        .map((e) => {
          const d = getFollowSetDTag(e) ?? ''
          return `${d}:${e.id}:${e.created_at}`
        })
        .sort()
        .join('|'),
    [followSetListEvents]
  )

  useEffect(() => {
    if (!pubkey || !isFollowFeedFauxSpellId(selectedFauxSpell)) {
      setFollowingSubRequests([])
      return
    }

    const followSetD =
      selectedFauxSpell && isFollowSetSpellId(selectedFauxSpell)
        ? decodeFollowSetSpellId(selectedFauxSpell)
        : null

    if (followSetD && followSetCatalogLoading) {
      setFollowingSubRequests([])
      return
    }

    let cancelled = false
    void (async () => {
      const augment = (raw: TFeedSubRequest[]) =>
        augmentSubRequestsWithFavoritesFastReadAndInbox(
          raw,
          favoriteRelays,
          blockedRelays,
          userReadRelaysWithHttp(relayList),
          { userWriteRelays: relayList?.write ?? [] }
        )
      try {
        if (selectedFauxSpell === 'following') {
          const fromTags = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
          const provisionalAuthors = [...new Set([pubkey, ...fromTags])]

          const inboxFallbackArgs = {
            favoriteRelays,
            blockedRelays,
            relayList,
            augment
          }

          const [rawProv, followings] = await Promise.all([
            racePromiseWithTimeout<TFeedSubRequest[]>(
              client.generateSubRequestsForPubkeys(provisionalAuthors, pubkey) as Promise<TFeedSubRequest[]>,
              FOLLOWING_GENERATE_SUBREQ_TIMEOUT_MS,
              () => []
            ),
            racePromiseWithTimeout(
              client.fetchFollowings(pubkey).catch(() => fromTags),
              FOLLOWING_FETCH_FOLLOWINGS_TIMEOUT_MS,
              () => fromTags
            )
          ])

          const provisionalNext =
            rawProv.length > 0
              ? augment(rawProv)
              : buildInboxShardFollowingSubRequests({
                  authors: provisionalAuthors,
                  ...inboxFallbackArgs
                })
          if (!cancelled) setFollowingSubRequests(provisionalNext)

          const fullAuthors = [...new Set([pubkey, ...followings])]
          const sameSet =
            fullAuthors.length === provisionalAuthors.length &&
            fullAuthors.every((p) => provisionalAuthors.includes(p)) &&
            provisionalAuthors.every((p) => fullAuthors.includes(p))
          if (sameSet) {
            return
          }

          const rawFull = await racePromiseWithTimeout<TFeedSubRequest[]>(
            client.generateSubRequestsForPubkeys(fullAuthors, pubkey) as Promise<TFeedSubRequest[]>,
            FOLLOWING_GENERATE_SUBREQ_TIMEOUT_MS,
            () => []
          )
          const fullNext =
            rawFull.length > 0
              ? augment(rawFull)
              : buildInboxShardFollowingSubRequests({ authors: fullAuthors, ...inboxFallbackArgs })
          if (!cancelled) setFollowingSubRequests(fullNext)
        } else if (followSetD) {
          const ev = followSetListEvents.find((e) => getFollowSetDTag(e) === followSetD)
          if (!ev) {
            if (!cancelled) setFollowingSubRequests([])
            return
          }
          const listed = pubkeysFromFollowSetEvent(ev)
          const authorPubkeys = [pubkey, ...listed]
          const rawFs = await racePromiseWithTimeout<TFeedSubRequest[]>(
            client.generateSubRequestsForPubkeys(authorPubkeys, pubkey) as Promise<TFeedSubRequest[]>,
            FOLLOWING_GENERATE_SUBREQ_TIMEOUT_MS,
            () => []
          )
          const req =
            rawFs.length > 0
              ? augment(rawFs)
              : buildInboxShardFollowingSubRequests({
                  authors: authorPubkeys,
                  favoriteRelays,
                  blockedRelays,
                  relayList,
                  augment
                })
          if (!cancelled) setFollowingSubRequests(req)
        } else {
          if (!cancelled) setFollowingSubRequests([])
        }
      } catch {
        if (!cancelled) setFollowingSubRequests([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    selectedFauxSpell,
    pubkey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    relayMailboxStableKey,
    followSetCatalogLoading,
    followSetListStableKey,
    followListEvent?.id,
    favoriteRelays,
    blockedRelays,
    relayList,
    followListEvent
  ])

  const interestTagsStableKey = interestListEvent
    ? JSON.stringify(
        [...interestListEvent.tags].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      )
    : ''
  const bookmarkTagsStableKey = bookmarkListEvent
    ? JSON.stringify(
        [...bookmarkListEvent.tags].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      )
    : ''

  const fauxFeedRelaysDepsKey = [
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    interestListEvent?.id ?? '',
    String(interestListEvent?.created_at ?? ''),
    interestTagsStableKey,
    bookmarkListEvent?.id ?? '',
    String(bookmarkListEvent?.created_at ?? ''),
    bookmarkTagsStableKey
  ].join('\0')

  const syncFauxSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (
      !selectedFauxSpell ||
      isFollowFeedFauxSpellId(selectedFauxSpell) ||
      selectedFauxSpell === 'heatMap' ||
      selectedFauxSpell === 'topicMap'
    )
      return []
    const fauxSpellSkipSocialKindBlocked =
      selectedFauxSpell === 'calendar' ||
      selectedFauxSpell === 'followPacks' ||
      selectedFauxSpell === 'media' ||
      selectedFauxSpell === 'bookmarks' ||
      selectedFauxSpell === 'interests'
    const feedUrls = ensureFauxSpellRelayStackTouchesFastRead(
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadRelaysWithHttp(relayList),
        {
          userWriteRelays: relayList?.write ?? [],
          applySocialKindBlockedFilter: fauxSpellSkipSocialKindBlocked ? false : undefined
        }
      )
    )

    if (selectedFauxSpell === 'notifications') {
      if (!notificationsFeedPubkey || !feedUrls.length) return []
      return buildNotificationsSpellSubRequests(feedUrls, notificationsFeedPubkey)
    }
    if (selectedFauxSpell === 'discussions') {
      if (!feedUrls.length) return []
      return [{ urls: feedUrls, filter: buildDiscussionFilter() }]
    }
    if (selectedFauxSpell === 'media') {
      if (!feedUrls.length) return []
      return [{ urls: feedUrls, filter: buildMediaSpellFilter() }]
    }
    if (selectedFauxSpell === 'calendar') {
      if (!feedUrls.length) return []
      return [{ urls: feedUrls, filter: buildCalendarSpellFilter() }]
    }
    if (selectedFauxSpell === 'interests') {
      if (!pubkey || !interestListEvent) return []
      const topics = interestListEvent.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1]!)
      return buildInterestsSubRequests(feedUrls, topics, DEFAULT_FEED_SHOW_KINDS)
    }
    if (selectedFauxSpell === 'bookmarks') {
      if (!pubkey) return []
      const idReqs = buildBookmarksSubRequests(bookmarkListEvent ?? null, feedUrls)
      const webReqs = buildWebBookmarksSpellSubRequests(pubkey, feedUrls)
      return [...idReqs, ...webReqs]
    }
    if (selectedFauxSpell === 'followPacks') {
      if (!feedUrls.length) return []
      return [
        {
          urls: feedUrls,
          filter: { kinds: [ExtendedKind.FOLLOW_PACK], limit: FAUX_SPELL_EVENT_LIMIT }
        }
      ]
    }
    return []
  }, [selectedFauxSpell, pubkey, notificationsFeedPubkey, fauxFeedRelaysDepsKey, relayMailboxStableKey, interestListEvent, bookmarkListEvent, favoriteRelays, blockedRelays, relayList])

  const fauxSubRequests = useMemo<TFeedSubRequest[]>(() => {
    const base = isFollowFeedFauxSpellId(selectedFauxSpell ?? '')
      ? followingSubRequests
      : syncFauxSubRequests
    return applyFauxSpellCapsToSubRequests(base)
  }, [selectedFauxSpell, followingSubRequests, syncFauxSubRequests])

  const spellSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!selectedSpell) return []
    const relayListWrite = relayList?.write ?? []
    const ctx = { pubkey: pubkey ?? null, contacts }
    const filter = spellEventToFilter(selectedSpell, ctx)
    if (!filter) return []
    const relays = getRelaysForSpell(selectedSpell, { relayListWrite })
    if (!relays.length) return []
    return [{ urls: relays, filter }]
  }, [selectedSpell, pubkey, contactsSyncKey, relayListWriteKey, contacts, relayList])

  const subRequests = useMemo<TFeedSubRequest[]>(() => {
    if (selectedFauxSpell) return fauxSubRequests
    return spellSubRequests
  }, [selectedFauxSpell, fauxSubRequests, spellSubRequests])

  const spellFeedSubscriptionKey = useMemo(() => {
    if (selectedFauxSpell) return computeSpellSubRequestsIdentityKey(subRequests)
    if (selectedSpell) return computeKind777SpellFeedSubscriptionKey(selectedSpell, subRequests)
    return ''
  }, [selectedFauxSpell, selectedSpell, subRequests])

  const spellBrowseRelayUrls = useMemo(() => {
    const set = new Set<string>()
    for (const req of subRequests) {
      for (const u of req.urls) {
        const n = normalizeUrl(u) || u
        if (n) set.add(n)
      }
    }
    return [...set].sort()
  }, [subRequests])

  const spellBrowseRelayUrlsKey = spellBrowseRelayUrls.join('|')

  const showKindsTagKey = useMemo(() => {
    if (!selectedSpell) return ''
    return selectedSpell.tags
      .filter((tag) => tag[0] === 'k')
      .map((tag) => tag[1])
      .sort()
      .join(',')
  }, [selectedSpell?.id])

  const followingShowKindsKey =
    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
      ? JSON.stringify(kindFilterShowKinds)
      : ''

  const showKinds = useMemo(() => {
    if (selectedFauxSpell === 'notifications') {
      return [...NOTIFICATION_SPELL_KINDS]
    }
    if (selectedFauxSpell === 'discussions') {
      return [ExtendedKind.DISCUSSION]
    }
    if (selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)) {
      const k = kindFilterShowKinds
      const out = [...k]
      if (!out.includes(nostrKinds.Repost)) out.push(nostrKinds.Repost)
      if (!out.includes(ExtendedKind.GENERIC_REPOST)) out.push(ExtendedKind.GENERIC_REPOST)
      return out.sort((x, y) => x - y)
    }
    if (selectedFauxSpell === 'followPacks') {
      return [ExtendedKind.FOLLOW_PACK]
    }
    if (selectedFauxSpell === 'media') {
      return [...MEDIA_SPELL_KINDS]
    }
    if (selectedFauxSpell === 'calendar') {
      return [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME]
    }
    if (selectedFauxSpell === 'interests') {
      return [...DEFAULT_FEED_SHOW_KINDS]
    }
    if (selectedFauxSpell === 'bookmarks') {
      const out = [...DEFAULT_FEED_SHOW_KINDS]
      if (!out.includes(ExtendedKind.WEB_BOOKMARK)) out.push(ExtendedKind.WEB_BOOKMARK)
      return out.sort((a, b) => a - b)
    }
    if (!selectedSpell) return [1]
    const kinds = selectedSpell.tags
      .filter((tag) => tag[0] === 'k')
      .map((tag) => parseInt(tag[1], 10))
      .filter((n) => !Number.isNaN(n))
    return kinds.length ? kinds : [1]
  }, [selectedFauxSpell, selectedSpell?.id, showKindsTagKey, followingShowKindsKey])

  const fauxNoteListUseFilterAsIs = useMemo(() => {
    if (!selectedFauxSpell) return true
    if (selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)) return false
    return true
  }, [selectedFauxSpell])

  const spellFauxMergeTimeline = useMemo(
    () => !!selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell),
    [selectedFauxSpell]
  )

  const notificationsMentionExtraHide = useCallback(
    (evt: Event) =>
      notificationsFeedPubkey ? !isUserInEventMentions(evt, notificationsFeedPubkey) : false,
    [notificationsFeedPubkey]
  )

  return {
    relayMailboxStableKey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    followingSubRequests,
    fauxSubRequests,
    subRequests,
    spellFeedSubscriptionKey,
    spellBrowseRelayUrls,
    spellBrowseRelayUrlsKey,
    showKinds,
    fauxNoteListUseFilterAsIs,
    spellFauxMergeTimeline,
    notificationsMentionExtraHide,
    hideRepliesFollowing,
    NOTIFICATION_SPELL_LOADING_SAFETY_MS,
    NOTIFICATION_SPELL_KINDS
  }
}
