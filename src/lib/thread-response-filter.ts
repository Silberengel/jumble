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
 * NIP-18 boosts: kind **6** (repost kind-1) and kind **16** (generic repost). Stats on OP/replies
 * only — never as thread rows (see notifications for full boost events).
 */
export function isThreadBoosterOnlyRow(evt: Event): boolean {
  return isNip18RepostKind(evt.kind)
}

/**
 * NIP-25 reactions: kind **7** and **17** (external). Stats on OP/replies only — never thread rows.
 */
export function isThreadReactionOnlyRow(evt: Event): boolean {
  return isNip25ReactionKind(evt.kind)
}

/** @deprecated Use {@link isThreadReactionOnlyRow} / {@link shouldHideThreadResponseEvent}. */
export function shouldHideOwnReactionThreadRow(
  item: Event,
  _viewerPubkey?: string | null
): boolean {
  return isThreadReactionOnlyRow(item)
}

/** @deprecated Use {@link shouldHideOwnReactionThreadRow}. */
export const shouldHideOwnReactionInOthersThread = shouldHideOwnReactionThreadRow

/** Hide thread replies / backlinks: boosts, reactions, muted author, or mute mentions. */
export function shouldHideThreadResponseEvent(
  evt: Event,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined
): boolean {
  if (isThreadBoosterOnlyRow(evt)) return true
  if (isThreadReactionOnlyRow(evt)) return true
  if (muteSetHas(mutePubkeySet, evt.pubkey)) return true
  if (hideContentMentioningMutedUsers === true && isMentioningMutedUsers(evt, mutePubkeySet)) return true
  return false
}
