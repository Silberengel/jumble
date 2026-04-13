import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
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

export type TRelayConnectionRow = { url: string; connected: boolean }

/**
 * Relays to show in “active relays” UI: favorites + NIP-65 read/write + defaults + fast-read,
 * then any pool-connected URL not already listed. {@link row.connected} reflects the live WebSocket.
 */
export function useRelayConnectionRows(): {
  rows: TRelayConnectionRow[]
  connectedCount: number
} {
  const { relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [connectedCanon, setConnectedCanon] = useState<Set<string>>(() =>
    new Set(client.getConnectedRelayUrls().map(canon))
  )

  useEffect(() => {
    const tick = () => setConnectedCanon(new Set(client.getConnectedRelayUrls().map(canon)))
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => clearInterval(id)
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

    const rows: TRelayConnectionRow[] = base.map((url) => ({
      url,
      connected: connectedCanon.has(canon(url))
    }))

    for (const url of client.getConnectedRelayUrls()) {
      const k = canon(url)
      if (baseCanon.has(k)) continue
      rows.push({ url, connected: true })
    }

    const connectedCount = rows.filter((r) => r.connected).length
    return { rows, connectedCount }
  }, [favoriteRelays, relayList?.read, relayList?.write, connectedCanon])
}
