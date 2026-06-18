import { mergeRepliesIntoMap, type TRepliesMap } from '@/lib/reply-index'
import activityTrace from '@/lib/activity-trace'
import type { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

type TReplyContext = {
  repliesMap: TRepliesMap
  addReplies: (replies: Event[]) => void
}

const ReplyContext = createContext<TReplyContext | undefined>(undefined)

/** Stable add callback — subscribe here instead of {@link ReplyContext} when only ingesting. */
const ReplyAddContext = createContext<((replies: Event[]) => void) | undefined>(undefined)

/** Returns undefined outside provider (e.g. isolated `createRoot` embeds or HMR context splits). */
export function useReplyOptional(): TReplyContext | undefined {
  return useContext(ReplyContext)
}

/** Stable `addReplies` that does not re-render when the global reply map changes. */
export function useReplyAddOptional(): ((replies: Event[]) => void) | undefined {
  return useContext(ReplyAddContext)
}

export const useReply = () => {
  const context = useReplyOptional()
  if (!context) {
    throw new Error('useReply must be used within a ReplyProvider')
  }
  return context
}

export function ReplyProvider({ children }: { children: React.ReactNode }) {
  const [repliesMap, setRepliesMap] = useState<TRepliesMap>(() => new Map())
  const pendingRepliesRef = useRef<Event[]>([])
  const flushScheduledRef = useRef(false)

  const flushPendingReplies = useCallback(() => {
    flushScheduledRef.current = false
    const batch = pendingRepliesRef.current
    if (batch.length === 0) return
    pendingRepliesRef.current = []
    activityTrace.trace('ingest', 'ReplyProvider.addReplies', { count: batch.length })
    setRepliesMap((prev) => mergeRepliesIntoMap(prev, batch))
  }, [])

  const addReplies = useCallback(
    (replies: Event[]) => {
      if (replies.length === 0) return
      pendingRepliesRef.current.push(...replies)
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true
        requestAnimationFrame(flushPendingReplies)
      }
    },
    [flushPendingReplies]
  )

  const replyContextValue = useMemo(
    () => ({
      repliesMap,
      addReplies
    }),
    [repliesMap, addReplies]
  )

  useEffect(() => {
    activityTrace.trace('provider', 'ReplyProvider.repliesMap', { buckets: repliesMap.size })
  }, [repliesMap])

  return (
    <ReplyAddContext.Provider value={addReplies}>
      <ReplyContext.Provider value={replyContextValue}>{children}</ReplyContext.Provider>
    </ReplyAddContext.Provider>
  )
}
