import { mergeRepliesIntoMap, type TRepliesMap } from '@/lib/reply-index'
import type { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useState } from 'react'

type TReplyContext = {
  repliesMap: TRepliesMap
  addReplies: (replies: Event[]) => void
}

const ReplyContext = createContext<TReplyContext | undefined>(undefined)

export const useReply = () => {
  const context = useContext(ReplyContext)
  if (!context) {
    throw new Error('useReply must be used within a ReplyProvider')
  }
  return context
}

export function ReplyProvider({ children }: { children: React.ReactNode }) {
  const [repliesMap, setRepliesMap] = useState<TRepliesMap>(() => new Map())

  const addReplies = useCallback((replies: Event[]) => {
    if (replies.length === 0) return
    setRepliesMap((prev) => mergeRepliesIntoMap(prev, replies))
  }, [])

  return (
    <ReplyContext.Provider
      value={{
        repliesMap,
        addReplies
      }}
    >
      {children}
    </ReplyContext.Provider>
  )
}
