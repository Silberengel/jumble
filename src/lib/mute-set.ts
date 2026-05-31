import type { Event } from 'nostr-tools'

/**
 * Mute pubkey sets use lowercase hex so lookups match Nostr events and `p` tags regardless of casing.
 */
export function muteSetHas(mutePubkeySet: ReadonlySet<string>, pubkey: string | undefined | null): boolean {
  if (!pubkey) return false
  return mutePubkeySet.has(pubkey.toLowerCase())
}

/** Drop notes whose author is in the viewer's public or private mute list. */
export function filterEventsExcludingMutedAuthors(
  events: readonly Event[],
  mutePubkeySet: ReadonlySet<string>
): Event[] {
  if (mutePubkeySet.size === 0) return [...events]
  return events.filter((ev) => !muteSetHas(mutePubkeySet, ev.pubkey))
}

/** Stable SETTINGS / cache segment when mute lists change. */
export function mutePubkeySetFingerprint(mutePubkeySet: ReadonlySet<string>): string {
  if (mutePubkeySet.size === 0) return '0'
  return [...mutePubkeySet].sort().join('\n')
}
