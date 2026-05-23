import { canonicalRelaySessionKey, normalizeAnyRelayUrl, normalizeHttpRelayUrl } from '@/lib/url'
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

export type TRelayConnectionRow = {
  url: string
  /** WebSocket open in the pool. */
  connected: boolean
}

/**
 * Relays for “active relays” UI: only relays with an open WebSocket in the pool right now.
 */
export function useRelayConnectionRows(): {
  rows: TRelayConnectionRow[]
  connectedCount: number
} {
  const [connectedUrls, setConnectedUrls] = useState<string[]>(() => client.getConnectedRelayUrls())

  useEffect(() => {
    const tick = () => setConnectedUrls(client.getConnectedRelayUrls())
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return useMemo(() => {
    const seen = new Set<string>()
    const rows: TRelayConnectionRow[] = []
    for (const raw of connectedUrls) {
      const url = normalizeRelayRowUrl(raw)
      const k = rowCanon(url)
      if (!k || seen.has(k)) continue
      seen.add(k)
      rows.push({ url, connected: true })
    }
    return { rows, connectedCount: rows.length }
  }, [connectedUrls])
}
