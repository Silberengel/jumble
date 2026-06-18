import { type TRepliesMap } from '@/lib/reply-index'
import { useThreadPanelIngestOptional } from '@/features/thread-panel/ThreadPanelContext'
import type { ThreadPanelSource } from '@/features/thread-panel/types'
import { useReplyAddOptional } from '@/providers/ReplyProvider'
import type { Event } from 'nostr-tools'
import { useCallback } from 'react'

const noopAddReplies = (_replies: Event[]) => {}
const EMPTY_REPLIES_MAP: TRepliesMap = new Map()

const REPLY_INGRESS_FALLBACK = {
  repliesMap: EMPTY_REPLIES_MAP,
  addReplies: noopAddReplies,
  scoped: false as const
}

/**
 * Reply ingress for publish/fetch paths: prefers the thread panel engine when
 * {@link ThreadPanelProvider} wraps the note page (avoids cross-thread pollution).
 *
 * Only subscribes to stable add/ingest callbacks — not the live reply map — so
 * PostEditor and fetch hooks do not re-render on every thread ingest.
 */
export function useReplyIngress() {
  const threadIngest = useThreadPanelIngestOptional()
  const replyAdd = useReplyAddOptional()

  const addReplies = useCallback(
    (events: Event[], source?: ThreadPanelSource) => {
      if (events.length === 0) return
      if (threadIngest) {
        threadIngest(events, source ?? 'live')
        return
      }
      replyAdd?.(events)
    },
    [threadIngest, replyAdd]
  )

  if (threadIngest) {
    return { repliesMap: EMPTY_REPLIES_MAP, addReplies, scoped: true as const }
  }
  if (replyAdd) {
    return { repliesMap: EMPTY_REPLIES_MAP, addReplies, scoped: false as const }
  }
  return REPLY_INGRESS_FALLBACK
}
