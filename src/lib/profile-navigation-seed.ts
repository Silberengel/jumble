import { getProfileFromEvent } from '@/lib/event-metadata'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { eventService } from '@/services/client.service'
import type { TProfile } from '@/types'

const seeds = new Map<string, TProfile>()

function normPubkey(pubkey: string): string {
  return pubkey.toLowerCase()
}

/**
 * Call before navigating to `/users/…` from a userbadge (or anywhere we already have a {@link TProfile}).
 * The secondary profile panel mounts outside {@link NoteFeedProfileContext}, so `useFetchProfile` would
 * otherwise start a cold relay/IDB path even though the feed row already resolved this profile.
 */
export function seedProfileForNavigation(profile: TProfile): void {
  if (!profile?.pubkey) return
  seeds.set(normPubkey(profile.pubkey), profile)
}

/**
 * Feed rows often have pubkey only (no `TProfile` yet). If kind-0 is already in the session LRU
 * (from notes in the feed), seed it so {@link useFetchProfile} on `/users/…` paints immediately.
 */
export function seedProfileForNavigationFromSessionIfKnown(pubkeyHex: string): void {
  const pk = pubkeyHex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) return
  const ev = eventService.getSessionMetadataForPubkey(pk)
  if (!ev || shouldDropEventOnIngest(ev)) return
  seedProfileForNavigation(getProfileFromEvent(ev))
}

/** Instant paint for `useFetchProfile` when opening the profile route from a seeded navigation. */
export function getSeededProfileForNavigation(pubkey: string): TProfile | undefined {
  const pk = normPubkey(pubkey)
  const p = seeds.get(pk)
  if (p && normPubkey(p.pubkey) === pk) return p
  return undefined
}
