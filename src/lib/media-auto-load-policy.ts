import { MEDIA_AUTO_LOAD_POLICY } from '@/constants'
import { isNsfwEvent } from '@/lib/event'
import type { TMediaAutoLoadPolicy } from '@/types'
import type { Event } from 'nostr-tools'

export type TResolveAutoLoadMediaParams = {
  policy: TMediaAutoLoadPolicy
  connectionType?: string
  authorPubkey?: string | null
  followings?: readonly string[]
  accountPubkey?: string | null
  /** When set, NIP-36 / legacy NSFW tags block automatic media load (tap-to-reveal still works). */
  sourceEvent?: Event | null
}

/** Whether media for a given author should load without an explicit tap. */
export function resolveAutoLoadMediaForAuthor({
  policy,
  connectionType,
  authorPubkey,
  followings = [],
  accountPubkey,
  sourceEvent
}: TResolveAutoLoadMediaParams): boolean {
  if (sourceEvent && isNsfwEvent(sourceEvent)) return false
  if (policy === MEDIA_AUTO_LOAD_POLICY.NEVER) return false
  if (policy === MEDIA_AUTO_LOAD_POLICY.ALWAYS) return true
  if (policy === MEDIA_AUTO_LOAD_POLICY.WIFI_ONLY) {
    return connectionType !== 'cellular'
  }
  if (policy === MEDIA_AUTO_LOAD_POLICY.FOLLOWS_ONLY) {
    if (!authorPubkey) return false
    if (accountPubkey && authorPubkey === accountPubkey) return true
    return followings.includes(authorPubkey)
  }
  return false
}

/** Coarse global flag (false when the policy needs per-author resolution). */
export function resolveGlobalAutoLoadMedia(
  policy: TMediaAutoLoadPolicy,
  connectionType?: string
): boolean {
  if (policy === MEDIA_AUTO_LOAD_POLICY.ALWAYS) return true
  if (policy === MEDIA_AUTO_LOAD_POLICY.NEVER) return false
  if (policy === MEDIA_AUTO_LOAD_POLICY.WIFI_ONLY) {
    return connectionType !== 'cellular'
  }
  return false
}
