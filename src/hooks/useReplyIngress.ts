import { type TRepliesMap } from '@/lib/reply-index'
import { useReplyOptional } from '@/providers/ReplyProvider'
import type { Event } from 'nostr-tools'
import { useThreadPanelIngressOptional } from '@/features/thread-panel/ThreadPanelContext'
import type { ThreadPanelSource } from '@/features/thread-panel/types'

const noopAddReplies = (_replies: Event[]) => {}
const EMPTY_REPLIES_MAP: TRepliesMap = new Map()

const REPLY_INGRESS_FALLBACK = {
  repliesMap: EMPTY_REPLIES_MAP,
  addReplies: noopAddReplies,
  scoped: false as const
}

/**
 * Reply map ingress for the open note panel: prefers the thread panel engine store when
 * {@link ThreadPanelProvider} wraps the note page (avoids cross-thread pollution).
 */
export function useReplyIngress() {
  const panel = useThreadPanelIngressOptional()
  if (panel) {
    const addReplies = (events: Event[], source?: ThreadPanelSource) => {
      panel.ingest(events, source ?? 'live')
    }
    return { repliesMap: panel.store.index, addReplies, scoped: true as const }
  }
  const global = useReplyOptional()
  if (global) {
    return { repliesMap: global.repliesMap, addReplies: global.addReplies, scoped: false as const }
  }
  return REPLY_INGRESS_FALLBACK
}
