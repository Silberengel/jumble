import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client, { JUMBLE_SESSION_RELAY_STRIKES_CHANGED } from '@/services/client.service'
import { useEffect, useMemo, useState } from 'react'

const POLL_MS = 1500

function canon(url: string): string {
  return (normalizeAnyRelayUrl(url) || url).trim().toLowerCase()
}

function mergeUniquePreserveOrder(...lists: (readonly string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (!list?.length) continue
    for (const raw of list) {
      const n = normalizeAnyRelayUrl(raw) || raw
      const k = canon(n)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
  }
  return out
}

export type TRelayConnectionRow = {
  url: string
  /** WebSocket in the pool is open. */
  connected: boolean
  /** Session strike threshold reached — app skips this relay for reads/publishes until cleared. */
  sessionStriked: boolean
}

/**
 * Relays to show in “active relays” UI: favorites + NIP-65 read/write + defaults + fast-read,
 * then any pool-connected URL not already listed. {@link row.connected} reflects the live WebSocket;
 * {@link row.sessionStriked} reflects {@link client.isSessionRelayStrikedForReads}.
 */
export function useRelayConnectionRows(): {
  rows: TRelayConnectionRow[]
  /** Relays that are both socket-connected and not session-striked (usable for REQs this session). */
  connectedCount: number
} {
  const { relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [connectedCanon, setConnectedCanon] = useState<Set<string>>(() =>
    new Set(client.getConnectedRelayUrls().map(canon))
  )
  const [strikesEpoch, setStrikesEpoch] = useState(0)

  useEffect(() => {
    const tick = () => setConnectedCanon(new Set(client.getConnectedRelayUrls().map(canon)))
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const bump = () => setStrikesEpoch((n) => n + 1)
    window.addEventListener(JUMBLE_SESSION_RELAY_STRIKES_CHANGED, bump)
    return () => window.removeEventListener(JUMBLE_SESSION_RELAY_STRIKES_CHANGED, bump)
  }, [])

  return useMemo(() => {
    const inbox = [...(relayList?.read ?? []), ...(relayList?.write ?? [])]
    const base = mergeUniquePreserveOrder(
      favoriteRelays,
      inbox,
      DEFAULT_FAVORITE_RELAYS,
      FAST_READ_RELAY_URLS
    )
    const baseCanon = new Set(base.map(canon))

    const rowFor = (url: string, socketConnected: boolean): TRelayConnectionRow => ({
      url,
      connected: socketConnected,
      sessionStriked: client.isSessionRelayStrikedForReads(url)
    })

    const rows: TRelayConnectionRow[] = base.map((url) =>
      rowFor(url, connectedCanon.has(canon(url)))
    )

    for (const url of client.getConnectedRelayUrls()) {
      const k = canon(url)
      if (baseCanon.has(k)) continue
      rows.push(rowFor(url, true))
    }

    const connectedCount = rows.filter((r) => r.connected && !r.sessionStriked).length
    return { rows, connectedCount }
  }, [favoriteRelays, relayList?.read, relayList?.write, connectedCanon, strikesEpoch])
}
