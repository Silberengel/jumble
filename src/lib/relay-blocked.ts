import { normalizeAnyRelayUrl } from '@/lib/url'

/** Paid Sovbit relay hostnames — operator renamed nostr.sovbit.host → relay.sovbit.host. */
const SOVBIT_PAID_RELAY_HOSTS = new Set(['nostr.sovbit.host', 'relay.sovbit.host'])

function relayHostname(url: string): string | null {
  const normalized = normalizeAnyRelayUrl(url) || url.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return null
  }
}

function relayHostMatchesBlocked(urlHost: string | null, blockedHost: string | null): boolean {
  if (!urlHost || !blockedHost) return false
  if (urlHost === blockedHost) return true
  if (SOVBIT_PAID_RELAY_HOSTS.has(urlHost) && SOVBIT_PAID_RELAY_HOSTS.has(blockedHost)) return true
  return false
}

/** True when the relay matches a blocked URL or shares its hostname (https vs wss). */
export function isRelayBlockedByUser(url: string, blockedRelays?: readonly string[]): boolean {
  if (!blockedRelays?.length) return false
  const normalized = normalizeAnyRelayUrl(url) || url.trim()
  if (!normalized) return false
  const host = relayHostname(normalized)
  for (const b of blockedRelays) {
    const blockedNorm = normalizeAnyRelayUrl(b) || b.trim()
    if (!blockedNorm) continue
    if (blockedNorm === normalized) return true
    if (relayHostMatchesBlocked(host, relayHostname(blockedNorm))) return true
  }
  return false
}
