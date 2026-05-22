import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import {
  getHttpRelayListFromEvent,
  getRelayListReadFromEventNoFastFallback
} from '@/lib/event-metadata'
import {
  canonicalRelaySessionKey,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  urlMatchesConfiguredHttpIndexRelay
} from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { useEffect, useMemo, useState } from 'react'

const POLL_MS = 1500

function normalizeRelayRowUrl(raw: string): string {
  const t = raw.trim()
  if (/^https?:\/\//i.test(t)) return normalizeHttpRelayUrl(t) || t
  return normalizeAnyRelayUrl(t) || t
}

function rowCanon(url: string): string {
  return (canonicalRelaySessionKey(url) || normalizeRelayRowUrl(url)).trim().toLowerCase()
}

function mergeUniquePreserveOrder(...lists: (readonly string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (!list?.length) continue
    for (const raw of list) {
      const n = normalizeRelayRowUrl(raw)
      const k = rowCanon(n)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
  }
  return out
}

export type TRelayConnectionRow = {
  url: string
  /** WebSocket open in the pool, or HTTP index relay in use for the viewer. */
  connected: boolean
}

/**
 * Relays for “active relays” UI: favorites + NIP-65 read/write + kind 10432 cache + kind 10243 HTTP index
 * + defaults + fast-read, then any pool-connected URL not already listed.
 */
export function useRelayConnectionRows(): {
  rows: TRelayConnectionRow[]
  /** Relays counted as active (open WebSocket or configured HTTP index). */
  connectedCount: number
} {
  const { relayList, cacheRelayListEvent, httpRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [connectedCanon, setConnectedCanon] = useState<Set<string>>(() =>
    new Set(client.getConnectedRelayUrls().map(rowCanon))
  )
  const [httpIndexBases, setHttpIndexBases] = useState<readonly string[]>(() =>
    client.getViewerHttpIndexRelayBases()
  )

  useEffect(() => {
    const tick = () => {
      setConnectedCanon(new Set(client.getConnectedRelayUrls().map(rowCanon)))
      setHttpIndexBases(client.getViewerHttpIndexRelayBases())
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const cacheRelayUrls = useMemo(() => {
    if (!cacheRelayListEvent) return []
    return getRelayListReadFromEventNoFastFallback(cacheRelayListEvent, blockedRelays)
  }, [cacheRelayListEvent, blockedRelays])

  const httpIndexRelayUrls = useMemo(() => {
    const out: string[] = [...(relayList?.httpRead ?? []), ...(relayList?.httpWrite ?? [])]
    if (httpRelayListEvent) {
      const http = getHttpRelayListFromEvent(httpRelayListEvent, blockedRelays)
      out.push(...http.httpRead, ...http.httpWrite)
    }
    return out
  }, [relayList?.httpRead, relayList?.httpWrite, httpRelayListEvent, blockedRelays])

  return useMemo(() => {
    const inbox = [...(relayList?.read ?? []), ...(relayList?.write ?? [])]
    const base = mergeUniquePreserveOrder(
      favoriteRelays,
      inbox,
      cacheRelayUrls,
      httpIndexRelayUrls,
      DEFAULT_FAVORITE_RELAYS,
      FAST_READ_RELAY_URLS
    )
    const baseCanon = new Set(base.map(rowCanon))

    const isConnected = (url: string) =>
      urlMatchesConfiguredHttpIndexRelay(url, httpIndexBases) || connectedCanon.has(rowCanon(url))

    const rowFor = (url: string): TRelayConnectionRow => ({
      url,
      connected: isConnected(url)
    })

    const rows: TRelayConnectionRow[] = base.map((url) => rowFor(url))

    for (const url of client.getConnectedRelayUrls()) {
      const k = rowCanon(url)
      if (baseCanon.has(k)) continue
      rows.push(rowFor(url))
    }

    const connectedCount = rows.filter((r) => r.connected).length
    return { rows, connectedCount }
  }, [
    favoriteRelays,
    relayList?.read,
    relayList?.write,
    cacheRelayUrls,
    httpIndexRelayUrls,
    connectedCanon,
    httpIndexBases
  ])
}
