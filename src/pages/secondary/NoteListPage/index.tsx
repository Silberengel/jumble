import { Favicon } from '@/components/Favicon'
import Nip05DomainEmptyState from '@/components/Nip05DomainPanel/Nip05DomainEmptyState'
import type { TNoteListRef } from '@/components/NoteList'
import NormalFeed from '@/components/NormalFeed'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  isSocialKindBlockedKind,
  NIP_SEARCH_DOCUMENT_KINDS,
  NIP_SEARCH_PAGE_KINDS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import {
  augmentSubRequestsWithFavoritesFastReadAndInbox,
  getRelayUrlsWithFavoritesFastReadAndInbox,
  userReadRelaysWithHttp
} from '@/lib/favorites-feed-relays'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toProfileList } from '@/lib/link'
import {
  buildAlexandriaEventsUrlForDTagParam,
  buildAlexandriaEventsUrlForHashtagParam
} from '@/lib/alexandria-events-search-url'
import { compareEventsForDTagQuery, eventMatchesDTagLooseQuery } from '@/lib/dtag-search'
import { fetchPubkeysFromDomain } from '@/lib/nip05'
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
  const { relayList, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const interestList = useInterestListOptional()
  const isSubscribed = interestList?.isSubscribed ?? (() => false)
  const subscribe = interestList?.subscribe ?? (async () => {})
  const [title, setTitle] = useState<React.ReactNode>(null)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const [data, setData] = useState<
    | {
        type: 'hashtag' | 'hashtagSearch' | 'search' | 'externalContent' | 'dtag'
        kinds?: number[]
        dtag?: string
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
    if (data.type === 'hashtag' || data.type === 'hashtagSearch') {
      const t = new URLSearchParams(window.location.search).get('t') ?? ''
      return buildAlexandriaEventsUrlForHashtagParam(t)
    }
    return null
  }, [data])

  // Get hashtag from URL if this is a hashtag page
  const hashtag = useMemo(() => {
    if (data?.type === 'hashtag' || data?.type === 'hashtagSearch') {
      const searchParams = new URLSearchParams(window.location.search)
      return searchParams.get('t')
    }
    return null
  }, [data])

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
      userWriteRelays: relayList?.write ?? [],
      applySocialKindBlockedFilter: kinds.length === 0 || kinds.some(isSocialKindBlockedKind),
      useGlobalFavoriteDefaults: useGlobalRelayBootstrap,
      includeGlobalFastRead: useGlobalRelayBootstrap
    }
    const hashtag = searchParams.get('t')
    const searchFromUrl = searchParams.get('s')
    if (hashtag && searchFromUrl) {
      setData({ type: 'hashtagSearch' })
      setTitle(`${t('Search')}: #${hashtag} · ${searchFromUrl}`)
      const relayUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadRelaysWithHttp(relayList),
        readUrlOpts
      )
      const mergedSearchKinds = Array.from(
        new Set<number>([...NIP_SEARCH_PAGE_KINDS, ...(kinds.length > 0 ? kinds : [])])
      ).sort((a, b) => a - b)
      setSubRequests([
        {
          filter: { '#t': [hashtag], ...(kinds.length > 0 ? { kinds } : {}) },
          urls: relayUrls
        },
        {
          filter: { search: searchFromUrl, kinds: mergedSearchKinds },
          urls: [...new Set([...relayUrls, ...SEARCHABLE_RELAY_URLS])]
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
    if (hashtag) {
      setData({ type: 'hashtag' })
      setTitle(`# ${hashtag}`)
      setSubRequests([
        {
          filter: { '#t': [hashtag], ...(kinds.length > 0 ? { kinds } : {}) },
          urls: getRelayUrlsWithFavoritesFastReadAndInbox(
            favoriteRelays,
            blockedRelays,
            userReadRelaysWithHttp(relayList),
            readUrlOpts
          )
        }
      ])
      // Set controls for hashtag subscribe button - check subscription status
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
              userReadRelaysWithHttp(relayList),
              { userWriteRelays: relayList?.write ?? [], useGlobalFavoriteDefaults: useGlobalRelayBootstrap, includeGlobalFastRead: useGlobalRelayBootstrap }
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
                userReadRelaysWithHttp(relayList),
                {
                  userWriteRelays: relayList?.write ?? [],
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
          // D-tag browse: exact `#d` REQ on index + user relays (no NIP-50 full-text — that is not the same as a d-tag pick).
          setTitle(`D-Tag: ${domain}`)
          setData({
            type: 'dtag',
            dtag: domain,
            kinds: kinds.length > 0 ? kinds : undefined
          })
          const relayUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
            favoriteRelays,
            blockedRelays,
            userReadRelaysWithHttp(relayList),
            readUrlOpts
          )
          const mergedReqKinds = Array.from(
            new Set([...NIP_SEARCH_DOCUMENT_KINDS, ...(kinds.length > 0 ? kinds : [])])
          ).sort((a, b) => a - b)
          const kindFilter = { kinds: mergedReqKinds }
          const dUrls = [...new Set([...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean), ...relayUrls])]
          setSubRequests([
            {
              filter: { '#d': [domain], ...kindFilter },
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
    if ((data?.type === 'hashtag' || data?.type === 'hashtagSearch') && pubkey) {
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
      (data?.type === 'hashtag' || data?.type === 'hashtagSearch' || data?.type === 'dtag')
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
          progressiveWarmupMatch={(ev) => eventMatchesDTagLooseQuery(data.dtag!, ev)}
          progressiveDocumentKinds={NIP_SEARCH_DOCUMENT_KINDS}
          oneShotAfterMergeComparator={(a, b) => compareEventsForDTagQuery(data.dtag!, a, b)}
          extraShouldHideEvent={(ev) => !eventMatchesDTagLooseQuery(data.dtag!, ev)}
          oneShotMergedCap={400}
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
      (data?.type === 'hashtag' || data?.type === 'hashtagSearch' || data?.type === 'dtag') ? (
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
