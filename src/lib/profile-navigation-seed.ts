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

/** Instant paint for `useFetchProfile` when opening the profile route from a seeded navigation. */
export function getSeededProfileForNavigation(pubkey: string): TProfile | undefined {
  const pk = normPubkey(pubkey)
  const p = seeds.get(pk)
  if (p && normPubkey(p.pubkey) === pk) return p
  return undefined
}
