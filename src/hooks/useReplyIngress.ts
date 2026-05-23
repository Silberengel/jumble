import { useReply } from '@/providers/ReplyProvider'
import { useThreadReplyOptional } from '@/providers/ThreadReplyProvider'

/**
 * Reply map ingress for the open note panel: prefers per-thread storage when
 * {@link ThreadReplyProvider} wraps the note page (avoids cross-thread pollution).
 */
export function useReplyIngress() {
  const thread = useThreadReplyOptional()
  const global = useReply()
  if (thread) {
    return { repliesMap: thread.repliesMap, addReplies: thread.addReplies, scoped: true as const }
  }
  return { repliesMap: global.repliesMap, addReplies: global.addReplies, scoped: false as const }
}
