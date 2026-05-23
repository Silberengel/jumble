import { mergeRepliesIntoMap, type TRepliesMap } from '@/lib/reply-index'
import type { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type TThreadReplyContext = {
  threadKey: string
  repliesMap: TRepliesMap
  addReplies: (replies: Event[]) => void
}

const ThreadReplyContext = createContext<TThreadReplyContext | undefined>(undefined)

export function ThreadReplyProvider({
  threadKey,
  children
}: {
  /** Stable id for the open note (hex event id or replaceable coordinate). */
  threadKey: string
  children: React.ReactNode
}) {
  const [repliesMap, setRepliesMap] = useState<TRepliesMap>(() => new Map())

  useEffect(() => {
    setRepliesMap(new Map())
  }, [threadKey])

  const addReplies = useCallback((replies: Event[]) => {
    if (replies.length === 0) return
    setRepliesMap((prev) => mergeRepliesIntoMap(prev, replies))
  }, [])

  const value = useMemo(
    () => ({ threadKey, repliesMap, addReplies }),
    [threadKey, repliesMap, addReplies]
  )

  return <ThreadReplyContext.Provider value={value}>{children}</ThreadReplyContext.Provider>
}

export function useThreadReplyOptional() {
  return useContext(ThreadReplyContext)
}
