import type { FeedDescriptor } from './descriptor'
import type { FeedRelayPolicyResult } from './relay-policy'
import type { FeedRuntimeSnapshot } from './runtime'

export type FeedDiagnosticsSnapshot = {
  descriptorKey: string
  surface: FeedDescriptor['surface']
  relayUrls: string[]
  droppedRelays: FeedRelayPolicyResult['dropped']
  runtime: Pick<
    FeedRuntimeSnapshot,
    | 'status'
    | 'stale'
    | 'rawCount'
    | 'visibleCount'
    | 'hiddenCount'
    | 'emptyReason'
    | 'relayOutcomes'
    | 'hasMore'
    | 'paginationStatus'
    | 'nextCursor'
    | 'pageError'
  >
}

export function buildFeedDiagnosticsSnapshot(args: {
  descriptor: FeedDescriptor
  relayPolicy: FeedRelayPolicyResult
  runtime: FeedRuntimeSnapshot
}): FeedDiagnosticsSnapshot {
  return {
    descriptorKey: args.descriptor.key,
    surface: args.descriptor.surface,
    relayUrls: args.relayPolicy.urls,
    droppedRelays: args.relayPolicy.dropped,
    runtime: {
      status: args.runtime.status,
      stale: args.runtime.stale,
      rawCount: args.runtime.rawCount,
      visibleCount: args.runtime.visibleCount,
      hiddenCount: args.runtime.hiddenCount,
      emptyReason: args.runtime.emptyReason,
      relayOutcomes: args.runtime.relayOutcomes,
      hasMore: args.runtime.hasMore,
      paginationStatus: args.runtime.paginationStatus,
      nextCursor: args.runtime.nextCursor,
      pageError: args.runtime.pageError
    }
  }
}

export function logFeedDiagnostics(label: string, snapshot: FeedDiagnosticsSnapshot) {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console
  console.debug(`[feed:${label}]`, snapshot)
}
