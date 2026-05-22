import { normalizeAnyRelayUrl } from '@/lib/url'

function relayHostname(url: string): string | null {
  const normalized = normalizeAnyRelayUrl(url) || url.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return null
  }
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
    if (host && relayHostname(blockedNorm) === host) return true
  }
  return false
}
