import { ExtendedKind } from '@/constants'
import { isReplyNoteEvent } from '@/lib/event'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** Kind 1 OPs, highlights, discussions, photos, voice posts — feed filter “Posts” group. */
export const FEED_POSTS_GROUP_KINDS: readonly number[] = [
  kinds.Highlights,
  ExtendedKind.DISCUSSION,
  ExtendedKind.PICTURE,
  ExtendedKind.VOICE
]

/** Kind 1 replies, comments, voice comments, superchats — feed filter “Replies” group. */
export const FEED_REPLIES_GROUP_KINDS: readonly number[] = [
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.ZAP_RECEIPT,
  ExtendedKind.PAYMENT_NOTIFICATION,
  ExtendedKind.MONERO_TIP_DISCLOSURE,
  ExtendedKind.MONERO_TIP_RECEIPT
]

export const FEED_GIT_GROUP_KINDS: readonly number[] = [
  ExtendedKind.GIT_REPO_ANNOUNCEMENT,
  ExtendedKind.GIT_ISSUE,
  ExtendedKind.GIT_RELEASE
]

const FEED_POSTS_GROUP_KIND_SET = new Set(FEED_POSTS_GROUP_KINDS)
const FEED_REPLIES_GROUP_KIND_SET = new Set(FEED_REPLIES_GROUP_KINDS)
const FEED_GIT_GROUP_KIND_SET = new Set(FEED_GIT_GROUP_KINDS)

export function isFeedPostsGroupEnabled(showKind1OPs: boolean, showKinds: readonly number[]): boolean {
  return showKind1OPs && FEED_POSTS_GROUP_KINDS.every((k) => showKinds.includes(k))
}

export function isFeedRepliesGroupEnabled(
  showKind1Replies: boolean,
  showKind1111: boolean,
  showKinds: readonly number[]
): boolean {
  return (
    showKind1Replies &&
    showKind1111 &&
    FEED_REPLIES_GROUP_KINDS.every((k) => showKinds.includes(k))
  )
}

export function isFeedGitGroupEnabled(showKinds: readonly number[]): boolean {
  return FEED_GIT_GROUP_KINDS.every((k) => showKinds.includes(k))
}

export function applyFeedPostsGroupToggle(
  showKinds: number[],
  enabled: boolean
): { showKinds: number[]; showKind1OPs: boolean } {
  const rest = showKinds.filter((k) => !FEED_POSTS_GROUP_KINDS.includes(k))
  if (!enabled) return { showKind1OPs: false, showKinds: rest }
  return {
    showKind1OPs: true,
    showKinds: Array.from(new Set([...rest, ...FEED_POSTS_GROUP_KINDS]))
  }
}

export function applyFeedRepliesGroupToggle(
  showKinds: number[],
  enabled: boolean
): { showKinds: number[]; showKind1Replies: boolean; showKind1111: boolean } {
  const rest = showKinds.filter((k) => !FEED_REPLIES_GROUP_KINDS.includes(k))
  if (!enabled) {
    return { showKind1Replies: false, showKind1111: false, showKinds: rest }
  }
  return {
    showKind1Replies: true,
    showKind1111: true,
    showKinds: Array.from(new Set([...rest, ...FEED_REPLIES_GROUP_KINDS]))
  }
}

export function applyFeedGitGroupToggle(showKinds: number[], enabled: boolean): number[] {
  const rest = showKinds.filter((k) => !FEED_GIT_GROUP_KINDS.includes(k))
  if (!enabled) return rest
  return Array.from(new Set([...rest, ...FEED_GIT_GROUP_KINDS]))
}

/**
 * Same rules as visible-row filtering when the home kind picker applies
 * (not {@link shouldHideEvent} / mute / trust layers).
 */
export function eventPassesNoteListKindPicker(
  event: Event,
  effectiveShowKinds: readonly number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean
): boolean {
  if (!effectiveShowKinds.includes(event.kind)) return false
  if (FEED_POSTS_GROUP_KIND_SET.has(event.kind) && !showKind1OPs) return false
  if (FEED_REPLIES_GROUP_KIND_SET.has(event.kind) && (!showKind1Replies || !showKind1111)) {
    return false
  }
  if (FEED_GIT_GROUP_KIND_SET.has(event.kind) && !isFeedGitGroupEnabled(effectiveShowKinds)) {
    return false
  }
  if (event.kind === kinds.ShortTextNote) {
    const isReply = isReplyNoteEvent(event)
    if (isReply && !showKind1Replies) return false
    if (!isReply && !showKind1OPs) return false
  }
  if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
  return true
}
