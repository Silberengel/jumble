/**
 * Standalone React context for feed state so HMR on `FeedProvider.tsx` does not recreate
 * `createContext()` (which breaks `useFeed` after Fast Refresh).
 */
import { createContext, useContext } from 'react'

export type TFeedContext = {
  /** Home Notes (OP): favorites plus Wisp trending only — no aggr, no FAST_READ padding. */
  relayUrls: string[]
  /**
   * Home Replies + Gallery: same OP base, then NIP-65 read inboxes (FAST_READ when empty), kind 10432 cache
   * read relays, HTTP index — never aggr (aggr is for side-panel threads, profiles, and spells only).
   */
  replyRelayUrls: string[]
  /** `favorites` or a relay-set id. */
  homeFeedRelaySource: string
  setHomeFeedRelaySource: (source: string) => void
  /** Human-readable label for the active home feed relay source. */
  homeFeedSourceLabel: string
}

export const FeedContext = createContext<TFeedContext | undefined>(undefined)

export function useFeed(): TFeedContext {
  const context = useContext(FeedContext)
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return context
}
