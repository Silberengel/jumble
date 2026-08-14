import { FAST_READ_RELAY_URLS, DEFAULT_FAVORITE_RELAYS, ExtendedKind } from '@/constants'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import storage from '@/services/local-storage.service'
import { createFavoriteRelaysDraftEvent, createBlockedRelaysDraftEvent, createRelaySetDraftEvent } from '@/lib/draft-event'
import { getReplaceableEventIdentifier } from '@/lib/event'
import { getRelaySetFromEvent } from '@/lib/event-metadata'
import { randomString } from '@/lib/random'
import { isWebsocketUrl, normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { parseBlockedRelayUrlsFromEvent, setViewerBlockedRelayUrls } from '@/lib/viewer-blocked-relays'
import client, { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { TRelaySet } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FavoriteRelaysContext } from './favorite-relays-context'
import { useNostr } from './NostrProvider'

export { useFavoriteRelays } from './favorite-relays-context'
export type { TFavoriteRelaysContext } from './favorite-relays-context'

export function FavoriteRelaysProvider({ children }: { children: React.ReactNode }) {
  const { favoriteRelaysEvent, blockedRelaysEvent, updateFavoriteRelaysEvent, updateBlockedRelaysEvent, pubkey, relayList, publish } = useNostr()
  const [favoriteRelays, setFavoriteRelays] = useState<string[]>([])
  const [blockedRelays, setBlockedRelays] = useState<string[]>([])
  /** False until kind 10006 is read from context or IndexedDB — avoids wiping the global block filter during boot. */
  const [blockedRelaysHydrated, setBlockedRelaysHydrated] = useState(false)
  const [relaySetEvents, setRelaySetEvents] = useState<Event[]>([])
  const [relaySets, setRelaySets] = useState<TRelaySet[]>([])

  useEffect(() => {
    let cancelled = false

    const applyNoFavoriteRelaysEvent = () => {
      let next: string[] = []

      if (pubkey) {
        const storedRelaySets = storage.getRelaySets()
        storedRelaySets.forEach(({ relayUrls }) => {
          relayUrls.forEach((url) => {
            if (!next.includes(url)) {
              next.push(url)
            }
          })
        })
      }

      const useGlobal = viewerUsesGlobalRelayDefaults({
        viewerPubkey: pubkey,
        favoriteRelayUrls: next,
        relayList
      })
      if (next.length === 0 && (useGlobal || pubkey)) {
        next = [...DEFAULT_FAVORITE_RELAYS]
      }

      if (cancelled) return
      setFavoriteRelays(next)
      setRelaySetEvents([])
    }

    const applyFavoriteRelaysEvent = async (event: Event) => {
      const relays: string[] = []
      const relaySetIds: string[] = []

      event.tags.forEach(([tagName, tagValue]) => {
        if (!tagValue) return

        if (tagName === 'relay') {
          const normalizedUrl = normalizeAnyRelayUrl(tagValue)
          if (normalizedUrl && !relays.includes(normalizedUrl)) {
            relays.push(normalizedUrl)
          }
        } else if (tagName === 'a') {
          const [kind, author, relaySetId] = tagValue.split(':')
          if (kind !== kinds.Relaysets.toString()) return
          if (!pubkey || author !== pubkey) return
          if (!relaySetId) return

          if (!relaySetIds.includes(relaySetId)) {
            relaySetIds.push(relaySetId)
          }
        }
      })

      if (cancelled) return
      setFavoriteRelays(relays)

      if (!pubkey || !relaySetIds.length) {
        setRelaySetEvents([])
        return
      }

      const storedRelaySetEvents = (
        await Promise.all(
          relaySetIds.map((id) => indexedDb.getReplaceableEvent(pubkey, kinds.Relaysets, id))
        )
      ).filter(Boolean) as Event[]

      if (cancelled) return
      setRelaySetEvents(storedRelaySetEvents)

      const relaySetDiscoverGlobal = viewerUsesGlobalRelayDefaults({
        viewerPubkey: pubkey,
        favoriteRelayUrls: relays,
        relayList
      })
      const normalizedRelays = [
        ...(relayList?.write ?? []).map((url) => normalizeAnyRelayUrl(url) || url),
        ...(relaySetDiscoverGlobal
          ? FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url)
          : [])
      ]
      const newRelaySetEvents = await queryService.fetchEvents(
        Array.from(new Set(normalizedRelays)).slice(0, 5),
        {
          kinds: [kinds.Relaysets],
          authors: [pubkey],
          '#d': relaySetIds
        }
      )
      if (cancelled) return

      const relaySetEventMap = new Map<string, Event>()
      newRelaySetEvents.forEach((fetched) => {
        const d = getReplaceableEventIdentifier(fetched)
        if (!d) return

        const old = relaySetEventMap.get(d)
        if (!old || old.created_at < fetched.created_at) {
          relaySetEventMap.set(d, fetched)
        }
      })
      const uniqueNewRelaySetEvents = relaySetIds
        .map((id, index) => {
          const fetched = relaySetEventMap.get(id)
          if (fetched) {
            return fetched
          }
          return storedRelaySetEvents[index] || null
        })
        .filter(Boolean) as Event[]
      setRelaySetEvents(uniqueNewRelaySetEvents)
      await Promise.all(
        uniqueNewRelaySetEvents.map((evt) => indexedDb.putReplaceableEvent(evt))
      )
    }

    if (favoriteRelaysEvent) {
      void applyFavoriteRelaysEvent(favoriteRelaysEvent)
      return () => {
        cancelled = true
      }
    }

    if (!pubkey) {
      applyNoFavoriteRelaysEvent()
      return () => {
        cancelled = true
      }
    }

    /** PWA / cold start: read kind 10012 from IndexedDB before NostrProvider finishes hydrating. */
    void indexedDb.getReplaceableEvent(pubkey, ExtendedKind.FAVORITE_RELAYS).then((stored) => {
      if (cancelled) return
      if (stored) {
        void applyFavoriteRelaysEvent(stored)
      } else {
        applyNoFavoriteRelaysEvent()
      }
    })

    return () => {
      cancelled = true
    }
  }, [favoriteRelaysEvent, pubkey, relayList])

  useEffect(() => {
    if (blockedRelaysEvent) {
      setBlockedRelays(parseBlockedRelayUrlsFromEvent(blockedRelaysEvent))
      setBlockedRelaysHydrated(true)
      return
    }

    if (!pubkey) {
      setBlockedRelays([])
      setBlockedRelaysHydrated(true)
      return
    }

    setBlockedRelaysHydrated(false)
    let cancelled = false
    void indexedDb.getReplaceableEvent(pubkey, ExtendedKind.BLOCKED_RELAYS).then((stored) => {
      if (cancelled) return
      setBlockedRelays(parseBlockedRelayUrlsFromEvent(stored ?? null))
      setBlockedRelaysHydrated(true)
    })

    return () => {
      cancelled = true
    }
  }, [blockedRelaysEvent, pubkey])

  useEffect(() => {
    if (!blockedRelaysHydrated) return
    setViewerBlockedRelayUrls(blockedRelays)
    client.closeViewerBlockedRelayConnections()
  }, [blockedRelays, blockedRelaysHydrated])

  useEffect(() => {
    setRelaySets(
      relaySetEvents.map((evt) => getRelaySetFromEvent(evt, blockedRelays)).filter(Boolean) as TRelaySet[]
    )
  }, [relaySetEvents, blockedRelays])

  const addFavoriteRelays = useCallback(
    async (relayUrls: string[]) => {
      const normalizedUrls = relayUrls
        .map((relayUrl) => normalizeAnyRelayUrl(relayUrl))
        .filter((url) => !!url && !favoriteRelays.includes(url))
      if (!normalizedUrls.length) return

      const draftEvent = createFavoriteRelaysDraftEvent(
        [...favoriteRelays, ...normalizedUrls],
        relaySetEvents
      )
      const newFavoriteRelaysEvent = await publish(draftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [favoriteRelays, relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const deleteFavoriteRelays = useCallback(
    async (relayUrls: string[]) => {
      const normalizedUrls = relayUrls
        .map((relayUrl) => normalizeAnyRelayUrl(relayUrl))
        .filter((url) => !!url && favoriteRelays.includes(url))
      if (!normalizedUrls.length) return

      const draftEvent = createFavoriteRelaysDraftEvent(
        favoriteRelays.filter((url) => !normalizedUrls.includes(url)),
        relaySetEvents
      )
      const newFavoriteRelaysEvent = await publish(draftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [favoriteRelays, relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const createRelaySet = useCallback(
    async (relaySetName: string, relayUrls: string[] = []) => {
      const normalizedUrls = relayUrls
        .map((url) => normalizeAnyRelayUrl(url))
        .filter((url) => isWebsocketUrl(url))
      const id = randomString()
      const relaySetDraftEvent = createRelaySetDraftEvent({
        id,
        name: relaySetName,
        relayUrls: normalizedUrls
      })
      const newRelaySetEvent = await publish(relaySetDraftEvent)
      await indexedDb.putReplaceableEvent(newRelaySetEvent)

      const favoriteRelaysDraftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, [
        ...relaySetEvents,
        newRelaySetEvent
      ])
      const newFavoriteRelaysEvent = await publish(favoriteRelaysDraftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [favoriteRelays, relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const addRelaySets = useCallback(
    async (newRelaySetEvents: Event[]) => {
      const favoriteRelaysDraftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, [
        ...relaySetEvents,
        ...newRelaySetEvents
      ])
      const newFavoriteRelaysEvent = await publish(favoriteRelaysDraftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [favoriteRelays, relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const deleteRelaySet = useCallback(
    async (id: string) => {
      const newRelaySetEvents = relaySetEvents.filter((event) => {
        return getReplaceableEventIdentifier(event) !== id
      })
      if (newRelaySetEvents.length === relaySetEvents.length) return

      const previousRelaySetEvents = relaySetEvents
      setRelaySetEvents(newRelaySetEvents)

      try {
        const draftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, newRelaySetEvents)
        const newFavoriteRelaysEvent = await publish(draftEvent)
        await updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
      } catch (e) {
        setRelaySetEvents(previousRelaySetEvents)
        throw e
      }
    },
    [favoriteRelays, relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const updateRelaySet = useCallback(
    async (newSet: TRelaySet) => {
      const draftEvent = createRelaySetDraftEvent(newSet)
      const newRelaySetEvent = await publish(draftEvent)
      await indexedDb.putReplaceableEvent(newRelaySetEvent)

      setRelaySetEvents((prev) => {
        return prev.map((event) => {
          if (getReplaceableEventIdentifier(event) === newSet.id) {
            return newRelaySetEvent
          }
          return event
        })
      })
    },
    [publish]
  )

  const reorderFavoriteRelays = useCallback(
    async (reorderedRelays: string[]) => {
      setFavoriteRelays(reorderedRelays)
      const draftEvent = createFavoriteRelaysDraftEvent(reorderedRelays, relaySetEvents)
      const newFavoriteRelaysEvent = await publish(draftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [relaySetEvents, publish, updateFavoriteRelaysEvent]
  )

  const addBlockedRelays = useCallback(
    async (relayUrls: string[]) => {
      const normalizedUrls = relayUrls
        .map((relayUrl) => normalizeAnyRelayUrl(relayUrl))
        .filter((url) => !!url && !blockedRelays.includes(url))
      if (!normalizedUrls.length) return
      const previousBlockedRelays = blockedRelays
      const newBlockedRelays = [...blockedRelays, ...normalizedUrls]
      setBlockedRelays(newBlockedRelays)
      try {
        const draftEvent = createBlockedRelaysDraftEvent(newBlockedRelays)
        const newBlockedRelaysEvent = await publish(draftEvent)
        updateBlockedRelaysEvent(newBlockedRelaysEvent)
      } catch (e) {
        setBlockedRelays(previousBlockedRelays)
        throw e
      }
    },
    [blockedRelays, publish, updateBlockedRelaysEvent]
  )

  const deleteBlockedRelays = useCallback(
    async (relayUrls: string[]) => {
      const normalizedUrls = relayUrls.map((relayUrl) => normalizeAnyRelayUrl(relayUrl)).filter(Boolean)
      const previousBlockedRelays = blockedRelays
      const newBlockedRelays = blockedRelays.filter((relay) => !normalizedUrls.includes(relay))
      setBlockedRelays(newBlockedRelays)
      try {
        const draftEvent = createBlockedRelaysDraftEvent(newBlockedRelays)
        const newBlockedRelaysEvent = await publish(draftEvent)
        updateBlockedRelaysEvent(newBlockedRelaysEvent)
      } catch (e) {
        setBlockedRelays(previousBlockedRelays)
        throw e
      }
    },
    [blockedRelays, publish, updateBlockedRelaysEvent]
  )

  const reorderRelaySets = useCallback(
    async (reorderedSets: TRelaySet[]) => {
      setRelaySets(reorderedSets)
      const draftEvent = createFavoriteRelaysDraftEvent(
        favoriteRelays,
        reorderedSets.map((set) => set.aTag)
      )
      const newFavoriteRelaysEvent = await publish(draftEvent)
      updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
    },
    [favoriteRelays, publish, updateFavoriteRelaysEvent]
  )

  /** Published kind 10012 `relay` tags (and relay sets via {@link relaySets}); trending is added in feed/UI layers. */
  const contextValue = useMemo(
    () => ({
      favoriteRelaysFromPublishedList: !!favoriteRelaysEvent,
      favoriteRelays,
      addFavoriteRelays,
      deleteFavoriteRelays,
      reorderFavoriteRelays,
      blockedRelays,
      addBlockedRelays,
      deleteBlockedRelays,
      relaySets,
      createRelaySet,
      addRelaySets,
      deleteRelaySet,
      updateRelaySet,
      reorderRelaySets
    }),
    [
      favoriteRelaysEvent,
      favoriteRelays,
      blockedRelays,
      relaySets,
      addFavoriteRelays,
      deleteFavoriteRelays,
      reorderFavoriteRelays,
      addBlockedRelays,
      deleteBlockedRelays,
      createRelaySet,
      addRelaySets,
      deleteRelaySet,
      updateRelaySet,
      reorderRelaySets
    ]
  )

  return (
    <FavoriteRelaysContext.Provider value={contextValue}>
      {children}
    </FavoriteRelaysContext.Provider>
  )
}
