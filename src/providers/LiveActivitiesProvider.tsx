import storage from '@/services/local-storage.service'
import {
  buildLiveActivitiesRelayUrls,
  filterLiveActivityItemsByReachableMedia,
  LIVE_ACTIVITY_KINDS,
  mergeLiveActivityEvents,
  msUntilNextQuarterHour,
  resolveParentSpacesForLiveActivities,
  type TLiveActivityItem
} from '@/lib/live-activities'
import { userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import logger from '@/lib/logger'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { registerSessionInteractivePrewarmListener } from '@/services/session-interactive-prewarm-bridge'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LiveActivitiesContext } from './live-activities-context'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useFollowListOptional } from './follow-list-context'
import { useNostr } from './NostrProvider'
import { useUserPreferencesOptional } from './UserPreferencesProvider'

export function LiveActivitiesProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, relayList, isInitialized, isAccountSessionHydrating } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followListCtx = useFollowListOptional()
  const followings = followListCtx?.followings ?? []
  const userPrefs = useUserPreferencesOptional()
  const showLiveActivitiesBanner =
    userPrefs?.showLiveActivitiesBanner ?? storage.getShowLiveActivitiesBanner()

  const useGlobalBootstrap = useMemo(
    () =>
      viewerUsesGlobalRelayDefaults({
        viewerPubkey: pubkey,
        favoriteRelayUrls: favoriteRelays,
        relayList
      }),
    [pubkey, favoriteRelays, relayList]
  )

  const [items, setItems] = useState<TLiveActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [carouselHiddenAddresses, setCarouselHiddenAddresses] = useState<ReadonlySet<string>>(() => new Set())
  const rawItemsRef = useRef<TLiveActivityItem[]>([])
  const hiddenCarouselRef = useRef<Set<string>>(new Set())

  const relayRead = useMemo(() => userReadRelaysWithHttp(relayList), [relayList])
  const relayWrite = relayList?.write ?? []

  const refresh = useCallback(async () => {
    if (!showLiveActivitiesBanner) {
      rawItemsRef.current = []
      setItems([])
      return
    }
    const loggedIn = Boolean(pubkey)
    const urls = buildLiveActivitiesRelayUrls({
      loggedIn,
      favoriteRelays,
      blockedRelays,
      relayListRead: relayRead,
      relayListWrite: relayWrite,
      includeGlobalFastRead: useGlobalBootstrap
    })
    if (urls.length === 0) {
      rawItemsRef.current = []
      setItems([])
      return
    }
    setLoading(true)
    try {
      const events = await client.fetchEvents(
        urls,
        { kinds: [...LIVE_ACTIVITY_KINDS], limit: 500 },
        { eoseTimeout: 6000, globalTimeout: 14_000 }
      )
      const parentByAddress = await resolveParentSpacesForLiveActivities(events, urls, (u, f, o) =>
        client.fetchEvents(u, f, o)
      )
      const merged = mergeLiveActivityEvents(events, followings, parentByAddress)
      const reachable = await filterLiveActivityItemsByReachableMedia(merged)
      rawItemsRef.current = reachable
      setItems(reachable.filter((i) => !hiddenCarouselRef.current.has(i.address)))
      logger.debug('[LiveActivities] poll done', {
        relayCount: urls.length,
        raw: events.length,
        merged: merged.length,
        afterStreamProbe: reachable.length
      })
    } catch (e) {
      logger.warn('[LiveActivities] poll failed', { err: e })
      rawItemsRef.current = []
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [
    showLiveActivitiesBanner,
    pubkey,
    favoriteRelays,
    blockedRelays,
    relayRead,
    relayWrite,
    followings,
    useGlobalBootstrap
  ])

  const toggleLiveActivityCarouselHidden = useCallback(async (address: string) => {
    const next = new Set(hiddenCarouselRef.current)
    if (next.has(address)) next.delete(address)
    else next.add(address)
    hiddenCarouselRef.current = next
    setCarouselHiddenAddresses(next)
    try {
      await indexedDb.setHiddenLiveActivityAddresses([...next])
    } catch (e) {
      logger.warn('[LiveActivities] persist carousel hide failed', { err: e })
    }
    setItems(rawItemsRef.current.filter((i) => !next.has(i.address)))
  }, [])

  useEffect(() => {
    let cancelled = false
    void indexedDb.getHiddenLiveActivityAddresses().then((s) => {
      if (cancelled) return
      hiddenCarouselRef.current = s
      setCarouselHiddenAddresses(s)
      setItems(rawItemsRef.current.filter((i) => !s.has(i.address)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    return registerSessionInteractivePrewarmListener(() => {
      void refreshRef.current()
    })
  }, [])

  useEffect(() => {
    if (!showLiveActivitiesBanner) {
      setItems([])
      return
    }
    if (!isInitialized) return
    if (pubkey && isAccountSessionHydrating) return
    void refresh()
  }, [
    showLiveActivitiesBanner,
    isInitialized,
    pubkey,
    isAccountSessionHydrating,
    refresh
  ])

  useEffect(() => {
    if (!showLiveActivitiesBanner) return
    const id = window.setTimeout(() => {
      void refreshRef.current()
    }, msUntilNextQuarterHour())
    const interval = window.setInterval(
      () => {
        void refreshRef.current()
      },
      15 * 60 * 1000
    )
    return () => {
      window.clearTimeout(id)
      window.clearInterval(interval)
    }
  }, [showLiveActivitiesBanner])

  const value = useMemo(
    () => ({
      items,
      loading,
      carouselHiddenAddresses,
      toggleLiveActivityCarouselHidden
    }),
    [items, loading, carouselHiddenAddresses, toggleLiveActivityCarouselHidden]
  )

  return <LiveActivitiesContext.Provider value={value}>{children}</LiveActivitiesContext.Provider>
}
