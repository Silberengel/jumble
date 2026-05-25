import { filterRelaysToUserAllowlist } from '@/lib/relay-allowlist'
import { normalizeAnyRelayUrl } from '@/lib/url'
import client from '@/services/client.service'
import { useEffect, useRef, useState } from 'react'

function relayListsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i])
}

export function useSeenOnRelays(
  eventId: string,
  allowedRelays?: readonly string[]
): string[] {
  const [relays, setRelays] = useState<string[]>([])
  const allowedRelaysRef = useRef(allowedRelays)
  allowedRelaysRef.current = allowedRelays
  const allowedRelaysKey = allowedRelays?.length
    ? [...allowedRelays]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|')
    : ''

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const maxAttempts = 20
    const apply = () => {
      const seenOn = client.getSeenEventRelayUrls(eventId)
      const allowlist = allowedRelaysRef.current
      const visible =
        allowlist?.length ? filterRelaysToUserAllowlist(seenOn, allowlist) : seenOn
      if (!cancelled) {
        setRelays((prev) => (relayListsEqual(prev, visible) ? prev : visible))
      }
      return visible.length > 0
    }
    if (apply()) return
    const id = setInterval(() => {
      if (cancelled) return
      attempts++
      if (apply() || attempts >= maxAttempts) clearInterval(id)
    }, 500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [eventId, allowedRelaysKey])

  return relays
}
