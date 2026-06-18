import { mergeRepliesIntoMap, type TRepliesMap } from '@/lib/reply-index'
import activityTrace from '@/lib/activity-trace'
import type { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

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

  const addReplies = useCallback((replies: Event[]) => {
    if (replies.length === 0) return
    activityTrace.trace('ingest', 'ReplyProvider.addReplies', { count: replies.length })
    setRepliesMap((prev) => mergeRepliesIntoMap(prev, replies))
  }, [])

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
