import { normalizeAnyRelayUrl } from '@/lib/url'
import type { TFeedSubRequest, TSubRequestFilter } from '@/types'
import type { Filter } from 'nostr-tools'

export type FeedExecutionMode = 'live' | 'one-shot'
export type FeedSurface =
  | 'home'
  | 'favorites'
  | 'relay'
  | 'relay-set'
  | 'profile'
  | 'profile-media'
  | 'profile-publications'
  | 'spells'
  | 'notifications'
  | 'replies'
  | 'thread'
  | 'embed'
  | 'search'
  | 'hashtag'
  | 'calendar'
  | 'relay-reviews'
  | 'bookmarks'
  | 'pins'
  | 'interests'
  | 'custom'

export type FeedViewPolicy = {
  showKinds?: readonly number[]
  clientSideKindFilter?: boolean
  includeReplies?: boolean
  gridLayout?: boolean
}

export type FeedSourcePolicy = {
  cache?: 'disabled' | 'stale-while-refresh' | 'fresh-required'
  publicReadFallback?: boolean
  preserveRowsOnRelayChange?: boolean
}

export type FeedPaginationPolicy = {
  enabled: boolean
  pageSize?: number
}

export type FeedDescriptor = {
  surface: FeedSurface
  id: string
  mode: FeedExecutionMode
  requests: readonly TFeedSubRequest[]
  view: FeedViewPolicy
  source: FeedSourcePolicy
  pagination: FeedPaginationPolicy
  key: string
}

export type FeedDescriptorInput = {
  surface: FeedSurface
  id?: string
  mode?: FeedExecutionMode
  requests: readonly TFeedSubRequest[]
  view?: FeedViewPolicy
  source?: FeedSourcePolicy
  pagination?: Partial<FeedPaginationPolicy>
}

type Jsonish = string | number | boolean | null | Jsonish[] | { [key: string]: Jsonish }

function normalizeScalar(value: unknown): Jsonish {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function stableValue(value: unknown): Jsonish {
  if (Array.isArray(value)) {
    return value.map(normalizeScalar).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Jsonish> = {}
    for (const [k, v] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      out[k] = stableValue(v)
    }
    return out
  }
  return normalizeScalar(value)
}

export function canonicalFeedFilter(filter: Omit<Filter, 'since' | 'until'> | TSubRequestFilter): Jsonish {
  return stableValue(filter)
}

export function canonicalRelayUrls(urls: readonly string[]): string[] {
  return Array.from(
    new Set(
      urls
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .map((u) => u.toLowerCase())
    )
  ).sort((a, b) => a.localeCompare(b))
}

export function canonicalFeedRequests(requests: readonly TFeedSubRequest[]): Jsonish {
  return requests
    .map((req) => ({
      urls: canonicalRelayUrls(req.urls),
      filter: canonicalFeedFilter(req.filter),
      reasonLabel: req.reasonLabel ?? null,
      reasonLabelIfSeenOnRelay: req.reasonLabelIfSeenOnRelay
        ? (normalizeAnyRelayUrl(req.reasonLabelIfSeenOnRelay) || req.reasonLabelIfSeenOnRelay.trim()).toLowerCase()
        : null
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function buildFeedDescriptorKey(input: Omit<FeedDescriptorInput, 'id'> & { id: string }): string {
  return JSON.stringify({
    surface: input.surface,
    id: input.id,
    mode: input.mode ?? 'live',
    requests: canonicalFeedRequests(input.requests),
    view: stableValue(input.view ?? {}),
    source: stableValue(input.source ?? {}),
    pagination: stableValue({
      enabled: input.pagination?.enabled ?? (input.mode ?? 'live') === 'live',
      pageSize: input.pagination?.pageSize ?? null
    })
  })
}

export function createFeedDescriptor(input: FeedDescriptorInput): FeedDescriptor {
  const id = input.id ?? input.surface
  const mode = input.mode ?? 'live'
  const pagination = {
    enabled: input.pagination?.enabled ?? mode === 'live',
    pageSize: input.pagination?.pageSize
  }
  const key = buildFeedDescriptorKey({ ...input, id, mode, pagination })
  return {
    surface: input.surface,
    id,
    mode,
    requests: input.requests,
    view: input.view ?? {},
    source: input.source ?? {},
    pagination,
    key
  }
}

export function legacyFeedSubscriptionKey(requests: readonly TFeedSubRequest[]): string {
  return JSON.stringify(canonicalFeedRequests(requests))
}

export function stableFeedKindKey(kinds: readonly number[] | undefined): string {
  if (!kinds?.length) return ''
  return JSON.stringify([...kinds].sort((a, b) => a - b))
}

export type FeedSessionSnapshotKeyInput = {
  feedKey: string
  homeSurface?: string
  allowKindlessRelayExplore?: boolean
  showAllKinds?: boolean
  kindsKey?: string
  showKind1OPs?: boolean
  showKind1Replies?: boolean
  showKind1111?: boolean
  seeAllFeedEvents?: boolean
}

export function buildFeedSessionSnapshotKey(input: FeedSessionSnapshotKeyInput): string {
  return JSON.stringify({
    feed: input.feedKey,
    ...(input.homeSurface ? { homeSurface: input.homeSurface } : {}),
    ...(input.allowKindlessRelayExplore
      ? { relayKindless: true, showAllKinds: input.showAllKinds }
      : {
          kinds: input.kindsKey ?? '',
          op: input.showKind1OPs,
          rep: input.showKind1Replies,
          c1111: input.showKind1111,
          seeAll: input.seeAllFeedEvents
        })
  })
}
