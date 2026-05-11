/**
 * Standalone React context for feed state so HMR on `FeedProvider.tsx` does not recreate
 * `createContext()` (which breaks `useFeed` after Fast Refresh).
 */
import { createContext, useContext } from 'react'

export type TFeedContext = {
  relayUrls: string[]
}

export const FeedContext = createContext<TFeedContext | undefined>(undefined)

export function useFeed(): TFeedContext {
  const context = useContext(FeedContext)
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return context
}
