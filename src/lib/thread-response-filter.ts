import { isMentioningMutedUsers, isNip18RepostKind } from '@/lib/event'
import { muteSetHas } from '@/lib/mute-set'
import { normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

/** Lowercase normalized URLs for comparing user-blocked relays (e.g. before REQ). */
export function buildNormalizedBlockedRelaySet(blockedRelays: readonly string[] | undefined): Set<string> {
  const s = new Set<string>()
  for (const u of blockedRelays ?? []) {
    const n = (normalizeUrl(u) || u).toLowerCase()
    if (n) s.add(n)
  }
  return s
}

/**
 * NIP-18 boosts: kind **6** (repost kind-1) and kind **16** (generic repost). Shown on the OP
 * booster strip only — never as discussion thread rows.
 */
export function isThreadBoosterOnlyRow(evt: Event): boolean {
  return isNip18RepostKind(evt.kind)
}

/** Hide thread replies / backlinks: boosts, wire-format JSON blobs, muted author, or mute mentions. */
export function shouldHideThreadResponseEvent(
  evt: Event,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined
): boolean {
  if (isThreadBoosterOnlyRow(evt)) return true
  if (muteSetHas(mutePubkeySet, evt.pubkey)) return true
  if (hideContentMentioningMutedUsers === true && isMentioningMutedUsers(evt, mutePubkeySet)) return true
  return false
}
