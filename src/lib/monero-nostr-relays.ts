import { MONERO_NOSTR_RELAY_URLS } from '@/constants'
import { pinMentionRelaysInRelayCap } from '@/lib/feed-relay-urls'
import { normalizeAnyRelayUrl } from '@/lib/url'

/** PMNR / Nosmero relays used for kind 9736 / 1814 / 9740 tip stats and notifications. */
export function moneroNostrRelayUrls(): readonly string[] {
  return MONERO_NOSTR_RELAY_URLS
}

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

/** Keep the full Monero relay set in capped notification / feed REQ stacks. */
export function pinMoneroNostrRelaysInRelayCap(
  capped: readonly string[],
  maxRelays: number
): string[] {
  const moneroRelays = [...MONERO_NOSTR_RELAY_URLS]
  return pinMentionRelaysInRelayCap(capped, moneroRelays, maxRelays, moneroRelays.length)
}
