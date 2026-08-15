import { Favicon } from '@/components/Favicon'
import Nip05DomainEmptyState from '@/components/Nip05DomainPanel/Nip05DomainEmptyState'
import type { TNoteListRef } from '@/components/NoteList'
import NormalFeed from '@/components/NormalFeed'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DOCUMENT_RELAY_URLS,
  ExtendedKind,
  isSocialKindBlockedKind,
  LIBRARY_RELAY_URLS,
  NIP_SEARCH_DOCUMENT_KINDS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import {
  augmentSubRequestsWithFavoritesFastReadAndInbox,
  getRelayUrlsWithFavoritesFastReadAndInbox,
  userReadInboxUrls,
  userWriteOutboxUrls
} from '@/lib/favorites-feed-relays'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toProfileList } from '@/lib/link'
import {
  buildAlexandriaEventsUrlForDTagParam,
  buildAlexandriaEventsUrlForHashtagParam
} from '@/lib/alexandria-events-search-url'
import {
  compareEventsForDTagQuery,
  compareEventsForDTagQueryWithPriorityKind,
  eventMatchesDTagQuery
} from '@/lib/dtag-search'
import { eventMatchesTopicOrContentHashtag, normalizeTopic, relayTopicTagFilterValues } from '@/lib/discussion-topics'
import { fetchPubkeysFromDomain } from '@/lib/nip05'
import {
  clearDevIndexRelayUnavailableThisSession,
  queryIndexRelayForLibrary
} from '@/lib/index-relay-http'
import { wikiDTagVariants } from '@/lib/nip54'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useInterestListOptional } from '@/providers/interest-list-context'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { normalizeUrl } from '@/lib/url'
import { UserRound, Plus } from 'lucide-react'
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface NoteListPageProps {
  index?: number
  hideTitlebar?: boolean
}

const NoteListPage = forwardRef<HTMLDivElement, NoteListPageProps>(({ index, hideTitlebar = false }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const feedRef = useRef<TNoteListRef>(null)
  const bumpFeed = useCallback(() => feedRef.current?.refresh(), [])
  const { push } = useSecondaryPage()
  const { relayList, cacheRelayListEvent, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const interestList = useInterestListOptional()
  const isSubscribed = interestList?.isSubscribed ?? (() => false)
  const subscribe = interestList?.subscribe ?? (async () => {})
  const [title, setTitle] = useState<React.ReactNode>(null)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const [data, setData] = useState<
    | {
        type: 'hashtag' | 'search' | 'externalContent' | 'dtag'
        kinds?: number[]
        dtag?: string
        /** Kind to float to the top of a d-tag browse (e.g. wiki kind 30818 from a wikilink). */
        priorityKind?: number
      }
    | {
        type: 'domain'
        domain: string
        kinds?: number[]
      }
    | null
  >(null)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  const alexandriaEmptyUrl = useMemo(() => {
    if (!data) return null
    if (data.type === 'dtag' && data.dtag) return buildAlexandriaEventsUrlForDTagParam(data.dtag)
    if (data.type === 'hashtag') {
      const t = new URLSearchParams(window.location.search).get('t') ?? ''
      return buildAlexandriaEventsUrlForHashtagParam(t)
    }
    return null
  }, [data])

  // Get hashtag from URL if this is a hashtag page
  const hashtag = useMemo(() => {
    if (data?.type === 'hashtag') {
      const searchParams = new URLSearchParams(window.location.search)
      return searchParams.get('t')
    }
    return null
  }, [data])

  const topicKey = useMemo(
    () => (hashtag ? normalizeTopic(hashtag) || hashtag.toLowerCase() : ''),
    [hashtag]
  )

  const topicMatchesEvent = useCallback(
    (ev: import('nostr-tools').Event) => eventMatchesTopicOrContentHashtag(ev, topicKey),
    [topicKey]
  )

  const shouldHideNonTopicEvent = useCallback(
    (ev: import('nostr-tools').Event) => !topicMatchesEvent(ev),
    [topicMatchesEvent]
  )

  // Check if the hashtag is already in the user's interest list
  const isHashtagSubscribed = useMemo(() => {
    if (!hashtag) return false
    return isSubscribed(hashtag)
  }, [hashtag, isSubscribed])

  // Add hashtag to interest list - wrapped in useCallback to prevent circular dependencies
  const handleSubscribeHashtag = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search)
    const hashtag = searchParams.get('t')
    if (!hashtag) return
    await subscribe(hashtag)
  }, [subscribe])

  // Extract initialization logic into a reusable function
  const initializeFromUrl = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search)
    const kinds = searchParams
      .getAll('k')
      .map((k) => parseInt(k))
      .filter((k) => !isNaN(k))
    const readUrlOpts = {
      userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent),
      applySocialKindBlockedFilter: kinds.length === 0 || kinds.some(isSocialKindBlockedKind),
      useGlobalFavoriteDefaults: useGlobalRelayBootstrap,
      includeGlobalFastRead: useGlobalRelayBootstrap
    }
    const hashtag = searchParams.get('t')
    if (hashtag) {
      const topicKey = normalizeTopic(hashtag) || hashtag.toLowerCase()
      setData({ type: 'hashtag' })
      setTitle(`# ${hashtag}`)
      setSubRequests([
        {
          filter: {
            '#t': relayTopicTagFilterValues(topicKey),
            ...(kinds.length > 0 ? { kinds } : {})
          },
          urls: getRelayUrlsWithFavoritesFastReadAndInbox(
            favoriteRelays,
            blockedRelays,
            userReadInboxUrls(relayList, cacheRelayListEvent),
            readUrlOpts
          )
        }
      ])
      const isSubscribedToHashtag = isSubscribed(hashtag)
      if (pubkey) {
        setControls(
          <Button
            variant="ghost"
            className="h-10 [&_svg]:size-3"
            onClick={handleSubscribeHashtag}
            disabled={isSubscribedToHashtag}
          >
            {isSubscribedToHashtag ? t('Subscribed') : t('Subscribe')} <Plus />
          </Button>
        )
      } else {
        setControls(null)
      }
      return
    }
    const search = searchParams.get('s')
      if (search) {
        setData({ type: 'search' })
        setTitle(`${t('Search')}: ${search}`)
        setSubRequests([
          {
            filter: { search, ...(kinds.length > 0 ? { kinds } : {}) },
            urls: SEARCHABLE_RELAY_URLS
          }
        ])
        return
      }
      const externalContentId = searchParams.get('i')
      if (externalContentId) {
        setData({ type: 'externalContent' })
        setTitle(externalContentId)
        setSubRequests([
          {
            filter: { '#I': [externalContentId], ...(kinds.length > 0 ? { kinds } : {}) },
            urls: getRelayUrlsWithFavoritesFastReadAndInbox(
              favoriteRelays,
              blockedRelays,
              userReadInboxUrls(relayList, cacheRelayListEvent),
              { userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent), useGlobalFavoriteDefaults: useGlobalRelayBootstrap, includeGlobalFastRead: useGlobalRelayBootstrap }
            )
          }
        ])
        return
      }
      const domain = searchParams.get('d')
      if (domain) {
        // Check if it looks like a domain (contains a dot) or is a d-tag search
        const looksLikeDomain = domain.includes('.')
        
        if (looksLikeDomain) {
          // Domain lookup (NIP-05)
          setTitle(
            <div className="flex items-center gap-1">
              {domain}
              <Favicon domain={domain} className="w-5 h-5" />
            </div>
          )
          const pubkeys = await fetchPubkeysFromDomain(domain)
          setData({
            type: 'domain',
            domain
          })
          if (pubkeys.length) {
            const raw = await client.generateSubRequestsForPubkeys(pubkeys, pubkey)
            setSubRequests(
              augmentSubRequestsWithFavoritesFastReadAndInbox(
                raw,
                favoriteRelays,
                blockedRelays,
                userReadInboxUrls(relayList, cacheRelayListEvent),
                {
                  userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent),
                  useGlobalFavoriteDefaults: useGlobalRelayBootstrap,
                  includeGlobalFastRead: useGlobalRelayBootstrap
                }
              )
            )
            setControls(
              <Button
                variant="ghost"
                className="h-10 [&_svg]:size-3"
                onClick={() => push(toProfileList({ domain }))}
              >
                {pubkeys.length.toLocaleString()} <UserRound />
              </Button>
            )
          } else {
            setSubRequests([])
          }
        } else {
          // D-tag browse: exact `#d` REQ. Wikilinks (pk=30818) use Mercury HTTP `#d` first —
          // the same fast path as wiki search — instead of waiting on a wide WS fan-out.
          const priorityKindRaw = parseInt(searchParams.get('pk') ?? '', 10)
          const priorityKind = isNaN(priorityKindRaw) ? undefined : priorityKindRaw
          const wikiWikilink = priorityKind === ExtendedKind.WIKI_ARTICLE
          setTitle(`D-Tag: ${domain}`)
          setData({
            type: 'dtag',
            dtag: domain,
            kinds: kinds.length > 0 ? kinds : undefined,
            priorityKind
          })
          const relayUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
            favoriteRelays,
            blockedRelays,
            userReadInboxUrls(relayList, cacheRelayListEvent),
            readUrlOpts
          )
          const mergedReqKinds = wikiWikilink
            ? [ExtendedKind.WIKI_ARTICLE]
            : Array.from(
                new Set([...NIP_SEARCH_DOCUMENT_KINDS, ...(kinds.length > 0 ? kinds : [])])
              ).sort((a, b) => a - b)
          const kindFilter = { kinds: mergedReqKinds }
          const dUrls = wikiWikilink
            ? [
                ...new Set(
                  [
                    ...DOCUMENT_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean),
                    ...relayUrls
                  ]
                )
              ]
            : [
                ...new Set([
                  ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean),
                  ...relayUrls
                ])
              ]

          if (wikiWikilink) {
            clearDevIndexRelayUnavailableThisSession()
            const mercuryBases = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))
            const dVariants = wikiDTagVariants(domain)
            void Promise.all(
              mercuryBases.flatMap((base) =>
                dVariants.map(async (dTag) => {
                  try {
                    const page = await queryIndexRelayForLibrary(base, {
                      kinds: [ExtendedKind.WIKI_ARTICLE],
                      '#d': [dTag],
                      limit: 50
                    })
                    for (const ev of page.events ?? []) {
                      if (ev.kind !== ExtendedKind.WIKI_ARTICLE) continue
                      client.addEventToCache(ev as import('nostr-tools').Event, {
                        explicitNoteLookupHexId: (ev as import('nostr-tools').Event).id
                      })
                    }
                  } catch {
                    /* best-effort Mercury seed for progressive warmup */
                  }
                })
              )
            )
          }

          setSubRequests([
            {
              filter: {
                '#d': wikiWikilink ? wikiDTagVariants(domain) : [domain],
                ...kindFilter
              },
              urls: dUrls
            }
          ])
        }
        return
      }
      
      // Advanced search parameters removed
      // Note: Only hashtag (t=) and kind (k=) URL parameters are supported
      // Date searches, pubkey filters, and event filters removed - not supported
  }, [
    pubkey,
    relayList,
    favoriteRelays,
    blockedRelays,
    handleSubscribeHashtag,
    push,
    t,
    isSubscribed,
    subscribe,
    client,
    useGlobalRelayBootstrap
  ])

  // Initialize on mount
  useEffect(() => {
    initializeFromUrl()
  }, [initializeFromUrl])

  // Listen for URL changes to re-initialize the page
  useEffect(() => {
    const handleLocationChange = () => {
      initializeFromUrl()
    }
    
    // Listen for browser back/forward navigation
    window.addEventListener('popstate', handleLocationChange)
    // Listen for custom hashtag navigation events
    window.addEventListener('hashtag-navigation', handleLocationChange)
    
    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.removeEventListener('hashtag-navigation', handleLocationChange)
    }
  }, [initializeFromUrl])

  // Update controls when subscription status changes
  useEffect(() => {
    if (data?.type === 'hashtag' && pubkey) {
      setControls(
        <Button
          variant="ghost"
          className="h-10 [&_svg]:size-3"
          onClick={handleSubscribeHashtag}
          disabled={isHashtagSubscribed}
        >
          {isHashtagSubscribed ? t('Subscribed') : t('Subscribe')} <Plus />
        </Button>
      )
    }
  }, [data, pubkey, isHashtagSubscribed, handleSubscribeHashtag, t])

  useEffect(() => {
    const inlineHeader =
      hideTitlebar &&
      (data?.type === 'hashtag' || data?.type === 'dtag')
    if (!hideTitlebar || inlineHeader) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpFeed)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, data?.type, registerPrimaryPanelRefresh, bumpFeed])

  let content: React.ReactNode = null
  if (data?.type === 'domain' && subRequests.length === 0) {
    content = <Nip05DomainEmptyState domain={data.domain} />
  } else if (data) {
    content =
      data.type === 'dtag' && data.dtag ? (
        <NormalFeed
          ref={feedRef}
          subRequests={subRequests}
          oneShotFetch
          progressiveWarmupQuery={data.dtag}
          progressiveWarmupMatch={(ev) => eventMatchesDTagQuery(data.dtag!, ev)}
          progressiveDocumentKinds={
            data.priorityKind === ExtendedKind.WIKI_ARTICLE
              ? [ExtendedKind.WIKI_ARTICLE]
              : NIP_SEARCH_DOCUMENT_KINDS
          }
          oneShotAfterMergeComparator={(a, b) =>
            data.priorityKind !== undefined
              ? compareEventsForDTagQueryWithPriorityKind(data.dtag!, data.priorityKind, a, b)
              : compareEventsForDTagQuery(data.dtag!, a, b)
          }
          extraShouldHideEvent={(ev) => !eventMatchesDTagQuery(data.dtag!, ev)}
          oneShotMergedCap={400}
          oneShotGlobalTimeoutMs={
            data.priorityKind === ExtendedKind.WIKI_ARTICLE ? 6_000 : undefined
          }
          oneShotEoseTimeoutMs={
            data.priorityKind === ExtendedKind.WIKI_ARTICLE ? 1_500 : undefined
          }
          oneShotFirstRelayGraceMs={
            data.priorityKind === ExtendedKind.WIKI_ARTICLE ? 600 : undefined
          }
          alexandriaEmptyUrl={alexandriaEmptyUrl}
        />
      ) : data.type === 'hashtag' ? (
        <NormalFeed
          ref={feedRef}
          subRequests={subRequests}
          extraShouldHideEvent={shouldHideNonTopicEvent}
          extraShouldHideRepliesEvent={shouldHideNonTopicEvent}
          progressiveWarmupQuery={topicKey || undefined}
          progressiveWarmupMatch={topicMatchesEvent}
          alexandriaEmptyUrl={alexandriaEmptyUrl}
        />
      ) : (
        <NormalFeed ref={feedRef} subRequests={subRequests} alexandriaEmptyUrl={alexandriaEmptyUrl} />
      )
  }

  const titlebarExtras = controls

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : title}
      controls={
        hideTitlebar ? undefined : (
          <div className="flex items-center gap-1">
            <RefreshButton onClick={bumpFeed} />
            {titlebarExtras}
          </div>
        )
      }
      displayScrollToTopButton
    >
      {hideTitlebar &&
      (data?.type === 'hashtag' || data?.type === 'dtag') ? (
        <>
          <div className="px-4 py-2 border-b">
            <div className="flex items-center justify-between gap-2">
              <div className="app-chrome-title">{title}</div>
              <div className="flex items-center gap-1">
                <RefreshButton onClick={bumpFeed} />
                {titlebarExtras}
              </div>
            </div>
          </div>
          <div className="pt-4">{content}</div>
        </>
      ) : (
        content
      )}
    </SecondaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage
