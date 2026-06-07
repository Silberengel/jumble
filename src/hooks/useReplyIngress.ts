import { type TRepliesMap } from '@/lib/reply-index'
import { useReplyOptional } from '@/providers/ReplyProvider'
import { useThreadReplyOptional } from '@/providers/ThreadReplyProvider'
import type { Event } from 'nostr-tools'

const noopAddReplies = (_replies: Event[]) => {}
const EMPTY_REPLIES_MAP: TRepliesMap = new Map()

const REPLY_INGRESS_FALLBACK = {
  repliesMap: EMPTY_REPLIES_MAP,
  addReplies: noopAddReplies,
  scoped: false as const
}

/**
 * Reply map ingress for the open note panel: prefers per-thread storage when
 * {@link ThreadReplyProvider} wraps the note page (avoids cross-thread pollution).
 */
export function useReplyIngress() {
  const thread = useThreadReplyOptional()
  if (thread) {
    return { repliesMap: thread.repliesMap, addReplies: thread.addReplies, scoped: true as const }
  }
  const global = useReplyOptional()
  if (global) {
    return { repliesMap: global.repliesMap, addReplies: global.addReplies, scoped: false as const }
  }
  return REPLY_INGRESS_FALLBACK
}
