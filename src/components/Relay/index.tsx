import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import RelayInfo from '@/components/RelayInfo'
import SearchInput from '@/components/SearchInput'
import { useFetchRelayInfo } from '@/hooks'
import type { TPrimaryPageName } from '@/PageManager'
import { SINGLE_RELAY_KINDLESS_REQ_LIMIT } from '@/constants'
import { isLocalNetworkUrl, normalizeAnyRelayUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import client from '@/services/client.service'
import type { TFeedSubRequest } from '@/types'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFound from '../NotFound'

const Relay = forwardRef<
  TNoteListRef,
  { url?: string; className?: string; hostPrimaryPageName?: TPrimaryPageName }
>(function Relay({ url, className, hostPrimaryPageName }, ref) {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const normalizedUrl = useMemo(() => (url ? normalizeAnyRelayUrl(url) : undefined), [url])
  const { relayInfo } = useFetchRelayInfo(normalizedUrl)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedInput, setDebouncedInput] = useState(searchInput)
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
      if (normalizeAnyRelayUrl(relayUrl) === normalizedUrl) {
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

  const relayFeedSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!normalizedUrl) return []
    const q = debouncedInput.trim()
    return [
      {
        urls: [normalizedUrl],
        filter: q
          ? { search: q, limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
          : { limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
      }
    ]
  }, [normalizedUrl, debouncedInput])

  /** When we know delivery relays, drop rows that never arrived from this feed’s relay (stale cache / mis-tagged). */
  const relaySeenMatchKey = useMemo(
    () => (normalizedUrl ? (normalizeAnyRelayUrl(normalizedUrl) || normalizedUrl).toLowerCase() : ''),
    [normalizedUrl]
  )
  const shouldHideEventNotFromThisRelay = useCallback(
    (ev: Event) => {
      if (!relaySeenMatchKey) return false
      // LAN/loopback: REQ already targets this relay; "seen on" often lists another URL first
      // (favorites merge, localhost vs 127.0.0.1, etc.) — hiding would empty the relay-only feed.
      if (normalizedUrl && isLocalNetworkUrl(normalizedUrl)) return false
      const seen = client.getSeenEventRelayUrls(ev.id)
      if (seen.length === 0) return false
      return !seen.some((u) => (normalizeAnyRelayUrl(u) || u).toLowerCase() === relaySeenMatchKey)
    },
    [relaySeenMatchKey, normalizedUrl]
  )

  if (!normalizedUrl) {
    return <NotFound />
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
        allowKindlessRelayExplore
        showAllKinds
        showFeedClientFilter
        hostPrimaryPageName={hostPrimaryPageName}
        extraShouldHideEvent={shouldHideEventNotFromThisRelay}
        extraShouldHideRepliesEvent={shouldHideEventNotFromThisRelay}
      />
    </div>
  )
})

Relay.displayName = 'Relay'
export default Relay
