import type { Event } from 'nostr-tools'
import type { TRepliesMap } from '@/lib/reply-index'

export type TRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

export type ThreadPanelSource =
  | 'session'
  | 'idb'
  | 'archives'
  | 'relay'
  | 'nested'
  | 'stats'
  | 'attestation'
  | 'live'

export type ThreadPanelStoreSnapshot = {
  byId: Map<string, Event>
  index: TRepliesMap
}

export type TThreadFeedItem =
  | { type: 'event'; event: Event }
  | { type: 'missing'; id: string; pubkey: string; created_at: number }

export type TBacklinkSubsection = 'primary' | 'bookmark' | 'list' | 'report'

export type TBacklinkDisplayRow =
  | { type: 'reply'; event: Event }
  | { type: 'missing-reply'; id: string; pubkey: string; created_at: number }
  | { type: 'backlink-run'; subsection: TBacklinkSubsection; events: Event[] }

export type ThreadPanelSort = 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped'

export type ThreadPanelView = {
  feed: TThreadFeedItem[]
  displayRows: TBacklinkDisplayRow[]
  loading: boolean
  quoteUiIdSet: Set<string>
}
