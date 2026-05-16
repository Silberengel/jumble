import { isMentioningMutedUsers, isNip18RepostKind, isNip25ReactionKind } from '@/lib/event'
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

/**
 * The signed-in user's NIP-25 reactions are already on the note stats bar — omit duplicate thread rows.
 * Counts still use {@link noteStatsService} / merged stats; this only affects thread list rendering.
 */
export function shouldHideOwnReactionThreadRow(
  item: Event,
  viewerPubkey: string | null | undefined
): boolean {
  const viewer = viewerPubkey?.trim().toLowerCase()
  if (!viewer || !/^[0-9a-f]{64}$/i.test(viewer)) return false
  if (item.pubkey.toLowerCase() !== viewer) return false
  return isNip25ReactionKind(item.kind)
}

/** @deprecated Use {@link shouldHideOwnReactionThreadRow}. */
export const shouldHideOwnReactionInOthersThread = shouldHideOwnReactionThreadRow

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
