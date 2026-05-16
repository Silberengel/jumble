import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

/** Long-form video threshold (matches publish-time kind 21 vs 22 split). */
export const LONG_VIDEO_MIN_DURATION_SEC = 600

/** NIP-71 kinds published for videos longer than {@link LONG_VIDEO_MIN_DURATION_SEC}. */
export function isLongFormNip71VideoEventKind(kind: number): boolean {
  return kind === ExtendedKind.VIDEO || kind === ExtendedKind.VIDEO_ADDRESSABLE
}

/**
 * Feed / timeline: do not fetch long-form video bytes until the user opts in.
 * Detail views pass `forceLoadMedia` / `mustLoadMedia` to bypass this.
 */
export function shouldDeferLongVideoAutoload(
  event: Event | null | undefined,
  options?: { forceLoadMedia?: boolean }
): boolean {
  if (options?.forceLoadMedia) return false
  if (!event) return false
  return isLongFormNip71VideoEventKind(event.kind)
}
