import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import RelayInfo from '@/components/RelayInfo'
import SearchInput from '@/components/SearchInput'
import { useFetchRelayInfo, useRelayPageFeedPolicy } from '@/hooks'
import type { TPrimaryPageName } from '@/PageManager'
import { SINGLE_RELAY_KINDLESS_REQ_LIMIT } from '@/constants'
import { canonicalRelaySessionKey, isLocalNetworkUrl, normalizeRelayUrlForPage } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import client from '@/services/client.service'
import type { TFeedSubRequest } from '@/types'
import { kinds, type Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'
import { buildAlexandriaEventsSearchUrlFromNotesQuery } from '@/lib/alexandria-events-search-url'
import { kindsForSingleRelayBrowse } from '@/lib/single-relay-browse-kinds'
import { stableFeedKindKey } from '@/features/feed/descriptor'
import NotFound from '../NotFound'

const Relay = forwardRef<
  TNoteListRef,
  {
    url?: string
    className?: string
    hostPrimaryPageName?: TPrimaryPageName
    alexandriaEmptyUrl?: string | null
    alexandriaNotFoundHref?: string | null
  }
>(function Relay(
  { url, className, hostPrimaryPageName, alexandriaEmptyUrl = null, alexandriaNotFoundHref = null },
  ref
) {
  const { t } = useTranslation()
  useRelayPageFeedPolicy()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const { showKinds } = useKindFilterOrDefaults()
  const normalizedUrl = useMemo(() => (url ? normalizeRelayUrlForPage(url) : undefined), [url])
  const { relayInfo } = useFetchRelayInfo(normalizedUrl)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedInput, setDebouncedInput] = useState(searchInput)
  /** After explicit-kinds REQ EOSEs empty, retry kindless `{ limit }` once (document/specialty relays). */
  const [kindlessBrowseFallback, setKindlessBrowseFallback] = useState(false)
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref ?? internalNoteListRef

  useEffect(() => {
    if (normalizedUrl) {
      addRelayUrls([normalizedUrl])
      return () => {
        removeRelayUrls([normalizedUrl])
      }
    }
  }, [normalizedUrl])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInput(searchInput)
    }, 1000)

    return () => {
      clearTimeout(handler)
    }
  }, [searchInput])

  // Listen for refresh events when user publishes to this relay
  useEffect(() => {
    if (!normalizedUrl) return

    const handleRelayRefresh = (event: CustomEvent) => {
      const { relayUrl } = event.detail
      if (canonicalRelaySessionKey(relayUrl) === canonicalRelaySessionKey(normalizedUrl)) {
        if (noteListRef && typeof noteListRef !== 'function') {
          noteListRef.current?.refresh()
        }
      }
    }

    window.addEventListener('relay-refresh-needed', handleRelayRefresh as EventListener)
    
    return () => {
      window.removeEventListener('relay-refresh-needed', handleRelayRefresh as EventListener)
    }
  }, [normalizedUrl, noteListRef])

  useEffect(() => {
    setKindlessBrowseFallback(false)
  }, [normalizedUrl])

  /** Default browse: explicit kinds (many strfry / small relays never return a useful kindless global REQ). */
  const relayBrowseKindsKey = useMemo(() => stableFeedKindKey(showKinds), [showKinds])
  const relayBrowseKinds = useMemo(
    () => (normalizedUrl ? kindsForSingleRelayBrowse(normalizedUrl, showKinds) : [kinds.ShortTextNote]),
    [relayBrowseKindsKey, showKinds, normalizedUrl]
  )

  const onSingleRelayBrowseEmpty = useCallback(() => {
    setKindlessBrowseFallback(true)
  }, [])

  const relayFeedSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!normalizedUrl) return []
    const q = debouncedInput.trim()
    if (q) {
      return [
        {
          urls: [normalizedUrl],
          filter: { search: q, limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
        }
      ]
    }
    if (kindlessBrowseFallback) {
      return [
        {
          urls: [normalizedUrl],
          filter: { limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
        }
      ]
    }
    return [
      {
        urls: [normalizedUrl],
        filter: { kinds: [...relayBrowseKinds], limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
      }
    ]
  }, [normalizedUrl, debouncedInput, relayBrowseKindsKey, kindlessBrowseFallback])

  const allowKindlessRelayExplore = debouncedInput.trim().length > 0

  /** When we know delivery relays, drop rows that never arrived from this feed’s relay (stale cache / mis-tagged). */
  const relaySeenMatchKey = useMemo(
    () => (normalizedUrl ? canonicalRelaySessionKey(normalizedUrl) : ''),
    [normalizedUrl]
  )
  const shouldHideEventNotFromThisRelay = useCallback(
    (ev: Event) => {
      if (allowKindlessRelayExplore) {
        return false
      }
      if (!relaySeenMatchKey) return false
      // LAN/loopback: REQ already targets this relay; "seen on" often lists another URL first
      // (favorites merge, localhost vs 127.0.0.1, etc.) — hiding would empty the relay-only feed.
      if (normalizedUrl && isLocalNetworkUrl(normalizedUrl)) return false
      const seen = client.getSeenEventRelayUrls(ev.id)
      if (seen.length === 0) return true
      return !seen.some((u) => canonicalRelaySessionKey(u) === relaySeenMatchKey)
    },
    [relaySeenMatchKey, normalizedUrl, allowKindlessRelayExplore]
  )

  const alexandriaFeedEmptyUrl = useMemo(() => {
    const q = debouncedInput.trim()
    if (q) return buildAlexandriaEventsSearchUrlFromNotesQuery(q)
    return alexandriaEmptyUrl
  }, [debouncedInput, alexandriaEmptyUrl])

  if (!normalizedUrl) {
    return (
      <NotFound>
        {alexandriaNotFoundHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaNotFoundHref} /> : null}
      </NotFound>
    )
  }

  return (
    <div className={className}>
      <RelayInfo url={normalizedUrl} className="pt-3" />
      {relayInfo?.supported_nips?.includes(50) && (
        <div className="px-4 py-2">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('Search')}
          />
        </div>
      )}
      <NormalFeed
        ref={noteListRef}
        subRequests={relayFeedSubRequests}
        useFilterAsIs
        allowKindlessRelayExplore={allowKindlessRelayExplore}
        showAllKinds
        showFeedClientFilter
        hostPrimaryPageName={hostPrimaryPageName}
        feedTimelineScopeKey={`relay:${normalizedUrl}`}
        extraShouldHideEvent={shouldHideEventNotFromThisRelay}
        extraShouldHideRepliesEvent={shouldHideEventNotFromThisRelay}
        relayAuthoritativeFeedOnly
        seenOnAllowlist={normalizedUrl ? [normalizedUrl] : undefined}
        onSingleRelayBrowseEmpty={onSingleRelayBrowseEmpty}
        alexandriaEmptyUrl={alexandriaFeedEmptyUrl}
      />
    </div>
  )
})

Relay.displayName = 'Relay'
export default Relay
