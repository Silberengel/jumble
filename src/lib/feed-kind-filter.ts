import { ExtendedKind } from '@/constants'
import { isReplyNoteEvent } from '@/lib/event'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

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
  if (event.kind === kinds.ShortTextNote) {
    const isReply = isReplyNoteEvent(event)
    if (isReply && !showKind1Replies) return false
    if (!isReply && !showKind1OPs) return false
  }
  if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
  if (event.kind === ExtendedKind.GIT_RELEASE && !showKind1OPs) return false
  return true
}
