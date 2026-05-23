import { MONERO_NOSTR_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'

/** Append PMNR / Nosmero relays when not already present (order preserved). */
export function appendMoneroNostrRelays(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const k = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(raw)
  }
  for (const raw of MONERO_NOSTR_RELAY_URLS) {
    const k = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(raw)
  }
  return out
}
