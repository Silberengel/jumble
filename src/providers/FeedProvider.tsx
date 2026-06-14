import { DEFAULT_FAVORITE_RELAYS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import {
  buildAllFavoritesFeedRelayUrls,
  buildHomeRelaySetFeedRelayUrls,
  ensureHomeFeedTrendingRelay,
  stripNostrLandAggrFromRelayUrls
} from '@/lib/home-feed-relays'
import {
  homeFeedSourceLabel,
  isHomeFeedRelaySetSource,
  normalizeHomeFeedRelaySource,
  resolveHomeFeedPrimaryRelayUrls
} from '@/lib/home-feed-relay-source'
import logger from '@/lib/logger'
import {
  syncViewerRelayStackNostrLandAggrEligible,
  urlsForViewerNostrLandAggrEligibilitySync
} from '@/lib/nostr-land-relay-eligibility'
import { getCacheRelayUrlsFromEvent } from '@/lib/private-relays'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import { collectUserReadInboxUrls } from '@/lib/viewer-read-inboxes'
import { collectUserWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import storage from '@/services/local-storage.service'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { FeedContext } from './feed-context'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useNostr } from './NostrProvider'
import { useTranslation } from 'react-i18next'

export type { TFeedContext } from './feed-context'

function relayUrlListIdentity(urls: string[]): string {
  return urls
    .map((u) => normalizeAnyRelayUrl(u) || u.trim())
    .filter(Boolean)
    .sort()
    .join('\n')
}

function buildHomeReplyFeedRelayUrls(
  primaryRelayUrls: string[],
  inboxRelayUrls: string[],
  cacheRelayUrls: string[],
  httpRelayUrls: string[],
  blockedRelays: string[]
): string[] {
  /** Home Replies/Gallery: never prepend aggr (reserved for side-panel threads, profiles, spells). */
  return ensureHomeFeedTrendingRelay(
    stripNostrLandAggrFromRelayUrls(
      feedRelayPolicyUrls(
        [
          { source: 'favorites', urls: primaryRelayUrls },
          { source: 'viewer-read', urls: inboxRelayUrls },
          { source: 'cache', urls: cacheRelayUrls },
          { source: 'http-index', urls: httpRelayUrls }
        ],
        {
          operation: 'read',
          blockedRelays,
          nostrLandAggr: 'never',
          applySocialKindBlockedFilter: false,
          allowThirdPartyLocalRelays: true
        }
      )
    )
  )
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { isInitialized, relayList, cacheRelayListEvent, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays, relaySets } = useFavoriteRelays()
  const [homeFeedRelaySource, setHomeFeedRelaySourceState] = useState(() =>
    normalizeHomeFeedRelaySource(storage.getHomeFeedRelaySource(), storage.getRelaySets())
  )

  const effectiveHomeFeedRelaySource = useMemo(
    () => normalizeHomeFeedRelaySource(homeFeedRelaySource, relaySets),
    [homeFeedRelaySource, relaySets]
  )

  useEffect(() => {
    if (effectiveHomeFeedRelaySource !== homeFeedRelaySource) {
      setHomeFeedRelaySourceState(effectiveHomeFeedRelaySource)
      storage.setHomeFeedRelaySource(effectiveHomeFeedRelaySource)
    }
  }, [effectiveHomeFeedRelaySource, homeFeedRelaySource])

  const setHomeFeedRelaySource = useCallback((source: string) => {
    const normalized = normalizeHomeFeedRelaySource(source, relaySets)
    setHomeFeedRelaySourceState(normalized)
    storage.setHomeFeedRelaySource(normalized)
  }, [relaySets])

  const homeFeedPrimaryRelayUrls = useMemo(() => {
    return resolveHomeFeedPrimaryRelayUrls(
      effectiveHomeFeedRelaySource,
      favoriteRelays,
      relaySets
    ).urls
  }, [effectiveHomeFeedRelaySource, favoriteRelays, relaySets])

  const homeFeedSourceLabelText = useMemo(
    () => homeFeedSourceLabel(effectiveHomeFeedRelaySource, relaySets, t),
    [effectiveHomeFeedRelaySource, relaySets, t]
  )

  const useGlobalRelayDefaults = useMemo(
    () =>
      viewerUsesGlobalRelayDefaults({
        viewerPubkey: pubkey,
        favoriteRelayUrls: homeFeedPrimaryRelayUrls,
        relayList
      }),
    [pubkey, homeFeedPrimaryRelayUrls, relayList]
  )

  /** Read-side layers merged into {@link replyRelayUrls}; {@link outboxRelayUrls} is only for aggr eligibility sync. */
  const replyExtraRelayLayers = useMemo(() => {
    const cacheRelayUrls = getCacheRelayUrlsFromEvent(cacheRelayListEvent)

    const hasReadMailbox =
      cacheRelayUrls.length > 0 ||
      (relayList?.read?.length ?? 0) > 0 ||
      (relayList?.httpRead?.length ?? 0) > 0
    const hasWriteMailbox =
      cacheRelayUrls.length > 0 ||
      (relayList?.write?.length ?? 0) > 0 ||
      (relayList?.httpWrite?.length ?? 0) > 0

    return {
      inboxRelayUrls: hasReadMailbox
        ? collectUserReadInboxUrls(relayList, cacheRelayUrls)
        : useGlobalRelayDefaults
          ? DEFAULT_FAVORITE_RELAYS
          : [],
      outboxRelayUrls: hasWriteMailbox
        ? collectUserWriteOutboxUrls(relayList, cacheRelayUrls)
        : useGlobalRelayDefaults
          ? DEFAULT_FAVORITE_RELAYS
          : [],
      /** Kept for feed-layer identity / aggr sync; URLs are merged into inbox/outbox above. */
      cacheRelayUrls: [] as string[],
      httpRelayUrls: [] as string[]
    }
  }, [relayList, cacheRelayListEvent, useGlobalRelayDefaults])

  /** Default relays immediately so feeds / sidebar REQ never wait on Nostr session restore. */
  const [relayUrls, setRelayUrls] = useState<string[]>(() => buildAllFavoritesFeedRelayUrls([], [], []))
  const [replyRelayUrls, setReplyRelayUrls] = useState<string[]>(() =>
    buildHomeReplyFeedRelayUrls(
      buildAllFavoritesFeedRelayUrls([], [], []),
      [],
      [],
      [],
      []
    )
  )
  /** Same logical relay policy result — reuse array ref so NoteList does not re-subscribe. */
  const setUrlStateIfChanged = useCallback(
    (setter: Dispatch<SetStateAction<string[]>>, next: string[]) => {
      setter((prev) => {
        if (relayUrlListIdentity(prev) === relayUrlListIdentity(next)) return prev
        return next
      })
    },
    []
  )

  /** Keeps {@link getViewerRelayStackNostrLandAggrEligible} in sync for non-home reads (threads, profiles, etc.). */
  useEffect(() => {
    syncViewerRelayStackNostrLandAggrEligible(
      urlsForViewerNostrLandAggrEligibilitySync({
        favoriteRelayUrls: homeFeedPrimaryRelayUrls,
        relayListRead: replyExtraRelayLayers.inboxRelayUrls,
        relayListWrite: replyExtraRelayLayers.outboxRelayUrls,
        cacheRelayRead: replyExtraRelayLayers.cacheRelayUrls,
        httpRelayRead: replyExtraRelayLayers.httpRelayUrls
      })
    )
  }, [homeFeedPrimaryRelayUrls, replyExtraRelayLayers])

  const lastHomeFeedUrlLogRef = useRef({ primary: '', reply: '' })
  const updateFeedRelayUrls = useCallback(() => {
    const usingRelaySet = isHomeFeedRelaySetSource(effectiveHomeFeedRelaySource)
    const primaryRelays = usingRelaySet
      ? buildHomeRelaySetFeedRelayUrls(homeFeedPrimaryRelayUrls, blockedRelays)
      : buildAllFavoritesFeedRelayUrls(
          homeFeedPrimaryRelayUrls,
          blockedRelays,
          [],
          useGlobalRelayDefaults
        )
    const replyRelays = usingRelaySet
      ? primaryRelays
      : buildHomeReplyFeedRelayUrls(
          primaryRelays,
          replyExtraRelayLayers.inboxRelayUrls,
          replyExtraRelayLayers.cacheRelayUrls,
          replyExtraRelayLayers.httpRelayUrls,
          blockedRelays
        )
    const primaryId = relayUrlListIdentity(primaryRelays)
    const replyId = relayUrlListIdentity(replyRelays)
    const prevUrls = lastHomeFeedUrlLogRef.current
    if (prevUrls.primary !== primaryId || prevUrls.reply !== replyId) {
      lastHomeFeedUrlLogRef.current = { primary: primaryId, reply: replyId }
      logger.debug('Updating home feed relay URLs:', {
        primaryRelays,
        replyRelays
      })
    }
    setUrlStateIfChanged(setRelayUrls, primaryRelays)
    setUrlStateIfChanged(setReplyRelayUrls, replyRelays)
  }, [
    effectiveHomeFeedRelaySource,
    homeFeedPrimaryRelayUrls,
    blockedRelays,
    replyExtraRelayLayers,
    setUrlStateIfChanged,
    useGlobalRelayDefaults
  ])

  const favoriteRelaysIdentity = useMemo(
    () =>
      [...homeFeedPrimaryRelayUrls]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [homeFeedPrimaryRelayUrls]
  )
  const blockedRelaysIdentity = useMemo(
    () =>
      [...blockedRelays]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [blockedRelays]
  )
  const replyExtraRelaysIdentity = useMemo(
    () =>
      [
        ...replyExtraRelayLayers.inboxRelayUrls,
        ...replyExtraRelayLayers.cacheRelayUrls,
        ...replyExtraRelayLayers.httpRelayUrls
      ]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [replyExtraRelayLayers]
  )
  const lastRelayInitDebugKey = useRef('')
  const lastHadFavoriteRelaysRef = useRef<boolean | null>(null)
  const relayUrlDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const initKey = [
      isInitialized ? '1' : '0',
      effectiveHomeFeedRelaySource,
      favoriteRelays.length,
      relaySets.length,
      homeFeedPrimaryRelayUrls.length,
      replyExtraRelayLayers.inboxRelayUrls.length,
      replyExtraRelayLayers.cacheRelayUrls.length,
      replyExtraRelayLayers.httpRelayUrls.length,
      blockedRelays.length
    ].join('\x1e')

    const flush = () => {
      if (initKey !== lastRelayInitDebugKey.current) {
        lastRelayInitDebugKey.current = initKey
        logger.debug('FeedProvider relay init:', {
          isInitialized,
          homeFeedRelaySource: effectiveHomeFeedRelaySource,
          favoriteRelays: favoriteRelays.length,
          relaySets: relaySets.length,
          primaryFeedRelays: homeFeedPrimaryRelayUrls.length,
          inboxRelays: replyExtraRelayLayers.inboxRelayUrls.length,
          cacheRelays: replyExtraRelayLayers.cacheRelayUrls.length,
          httpRelays: replyExtraRelayLayers.httpRelayUrls.length,
          blockedRelays: blockedRelays.length
        })
      }

      const hasFavoriteRelays = homeFeedPrimaryRelayUrls.length > 0
      const prevHad = lastHadFavoriteRelaysRef.current
      lastHadFavoriteRelaysRef.current = hasFavoriteRelays
      if (!hasFavoriteRelays && prevHad !== false) {
        logger.debug('FeedProvider: no home feed relays for current source, using defaults')
      }

      updateFeedRelayUrls()
    }

    if (relayUrlDebounceTimerRef.current) {
      clearTimeout(relayUrlDebounceTimerRef.current)
    }
    relayUrlDebounceTimerRef.current = setTimeout(() => {
      relayUrlDebounceTimerRef.current = null
      flush()
    }, 80)

    return () => {
      if (relayUrlDebounceTimerRef.current) {
        clearTimeout(relayUrlDebounceTimerRef.current)
        relayUrlDebounceTimerRef.current = null
      }
    }
  }, [
    isInitialized,
    effectiveHomeFeedRelaySource,
    favoriteRelaysIdentity,
    blockedRelaysIdentity,
    replyExtraRelaysIdentity,
    updateFeedRelayUrls
  ])

  return (
    <FeedContext.Provider
      value={useMemo(
        () => ({
          relayUrls,
          replyRelayUrls,
          homeFeedRelaySource: effectiveHomeFeedRelaySource,
          setHomeFeedRelaySource,
          homeFeedSourceLabel: homeFeedSourceLabelText
        }),
        [
          relayUrls,
          replyRelayUrls,
          effectiveHomeFeedRelaySource,
          setHomeFeedRelaySource,
          homeFeedSourceLabelText
        ]
      )}
    >
      {children}
    </FeedContext.Provider>
  )
}
