import type { TRelayList } from '@/types'
import { normalizeAnyRelayUrl } from '@/lib/url'

/** Paid / subscription relay — presence in favorites or NIP-65 lists implies access to the matching aggregator. */
export const NOSTR_LAND_WSS = 'wss://nostr.land'

/** Aggregator for nostr.land subscribers only; others get auth / policy errors if contacted. */
export const AGGR_NOSTR_LAND_WSS = 'wss://aggr.nostr.land'

function canonWs(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

const NOSTR_LAND_CANON = canonWs(NOSTR_LAND_WSS)
const AGGR_CANON = canonWs(AGGR_NOSTR_LAND_WSS)

/** True if this URL is the nostr.land websocket (normalized). */
export function isNostrLandWsUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  return canonWs(url) === NOSTR_LAND_CANON
}

/** True if this URL is the nostr.land aggregator websocket (normalized). */
export function isAggrNostrLandWsUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  return canonWs(url) === AGGR_CANON
}

/** True if any normalized URL equals nostr.land. */
export function relayUrlListMentionsNostrLand(urls: readonly string[] | undefined): boolean {
  if (!urls?.length) return false
  for (const u of urls) {
    if (isNostrLandWsUrl(u)) return true
  }
  return false
}

/** True if nostr.land appears in any NIP-65 / HTTP relay list slice. */
export function nip65RelayListMentionsNostrLand(rl: TRelayList | null | undefined): boolean {
  if (!rl) return false
  return (
    relayUrlListMentionsNostrLand(rl.read) ||
    relayUrlListMentionsNostrLand(rl.write) ||
    relayUrlListMentionsNostrLand(rl.httpRead) ||
    relayUrlListMentionsNostrLand(rl.httpWrite)
  )
}

/**
 * Subscriber may use {@link AGGR_NOSTR_LAND_WSS}: they listed nostr.land in kind-10012 favorites or NIP-65 lists.
 */
export function viewerMayUseNostrLandAggr(
  favoriteRelays: readonly string[] | undefined,
  nip65: TRelayList | null | undefined
): boolean {
  if (relayUrlListMentionsNostrLand(favoriteRelays)) return true
  return nip65RelayListMentionsNostrLand(nip65 ?? undefined)
}

/**
 * Drop {@link AGGR_NOSTR_LAND_WSS} when the viewer is not a nostr.land subscriber; otherwise ensure it appears once.
 */
export function applyNostrLandAggrRelayPolicy(urls: readonly string[], allowAggr: boolean): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const c = canonWs(u)
    if (!c || seen.has(c)) return
    if (!allowAggr && c === AGGR_CANON) return
    seen.add(c)
    out.push(normalizeAnyRelayUrl(u) || u.trim())
  }
  for (const u of urls) {
    push(u)
  }
  if (allowAggr && !seen.has(AGGR_CANON)) {
    out.unshift(AGGR_NOSTR_LAND_WSS)
  }
  return out
}

/** Remove the aggregator from relay stacks that must stay strictly user-curated (favorites feed). */
export function stripNostrLandAggrRelay(urls: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    const c = canonWs(u)
    if (!c || c === AGGR_CANON || seen.has(c)) continue
    seen.add(c)
    out.push(normalizeAnyRelayUrl(u) || u.trim())
  }
  return out
}

/**
 * Feed/read surfaces should always hit the nostr.land aggregator. Prepend it before relay caps
 * can drop it, unless the user explicitly blocked it for that surface.
 */
export function ensureNostrLandAggrRelay(
  urls: readonly string[],
  options: { blockedRelays?: readonly string[]; maxRelays?: number } = {}
): string[] {
  const blocked = new Set((options.blockedRelays ?? []).map(canonWs))
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const c = canonWs(u)
    if (!c || blocked.has(c) || seen.has(c)) return
    seen.add(c)
    out.push(normalizeAnyRelayUrl(u) || u.trim())
  }
  push(AGGR_NOSTR_LAND_WSS)
  for (const u of urls) {
    push(u)
  }
  return typeof options.maxRelays === 'number' ? out.slice(0, options.maxRelays) : out
}
