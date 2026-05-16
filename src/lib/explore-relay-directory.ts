import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import { isExploreBrowsableRelayUrl } from '@/lib/explore-popular-relays'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { ViewerRelayListLike } from '@/lib/viewer-relay-defaults'
import type { Event } from 'nostr-tools'

export type ExploreRelaySourceFlags = {
  inMailboxRead: boolean
  inMailboxWrite: boolean
  inMailboxHttpRead: boolean
  inUserFavorites: boolean
  inAppDefaults: boolean
  inFastRead: boolean
  inNip66Cache: boolean
}

export type ExploreRelayEntry = {
  url: string
  score: number
  sourceFlags: ExploreRelaySourceFlags
  /** Pubkeys from people you follow who favorited this relay (most first in UI). */
  favoritedBy: string[]
  /** Newest-first relay reviews for this URL. */
  reviews: Event[]
}

const SCORE_MAILBOX_READ = 10_000
const SCORE_MAILBOX_WRITE = 8_000
const SCORE_MAILBOX_HTTP = 2_000
const SCORE_USER_FAVORITE = 5_000
const SCORE_PER_FOLLOWING_FAVORITER = 100
const SCORE_FOLLOWING_FAVORITERS_CAP = 2_000
const SCORE_PER_REVIEW = 50
const SCORE_REVIEWS_CAP = 500
const SCORE_STACK_BUMP = 10

export function scoreExploreRelayEntry(
  flags: ExploreRelaySourceFlags,
  followingFavoriteCount: number,
  reviewCount: number,
  stackFrequency: number
): number {
  let score = 0
  if (flags.inMailboxRead) score += SCORE_MAILBOX_READ
  if (flags.inMailboxWrite) score += SCORE_MAILBOX_WRITE
  if (flags.inMailboxHttpRead) score += SCORE_MAILBOX_HTTP
  if (flags.inUserFavorites) score += SCORE_USER_FAVORITE
  score += Math.min(
    followingFavoriteCount * SCORE_PER_FOLLOWING_FAVORITER,
    SCORE_FOLLOWING_FAVORITERS_CAP
  )
  score += Math.min(reviewCount * SCORE_PER_REVIEW, SCORE_REVIEWS_CAP)
  score += Math.min(stackFrequency * SCORE_STACK_BUMP, 60)
  return score
}

type MutableRelayRow = {
  url: string
  flags: ExploreRelaySourceFlags
  stackFrequency: number
  favoritedBy: string[]
  reviews: Event[]
}

export type BuildExploreRelayDirectoryOptions = {
  relayList: ViewerRelayListLike
  favoriteRelays: readonly string[]
  blockedRelays: readonly string[]
  nip66CachedUrls?: readonly string[]
  followingFavorites?: readonly (readonly [string, readonly string[]])[]
  reviewsByRelay?: ReadonlyMap<string, readonly Event[]>
  max?: number
}

function normalizeBlocked(blockedRelays: readonly string[]): Set<string> {
  return new Set(
    blockedRelays.map((b) => normalizeAnyRelayUrl(b) || b.trim()).filter(Boolean)
  )
}

function getOrCreateRow(
  rows: Map<string, MutableRelayRow>,
  raw: string,
  blocked: Set<string>
): MutableRelayRow | undefined {
  if (!isExploreBrowsableRelayUrl(raw)) return undefined
  const url = normalizeAnyRelayUrl(raw) || raw.trim()
  if (!url || blocked.has(url)) return undefined
  let row = rows.get(url)
  if (!row) {
    row = {
      url,
      flags: {
        inMailboxRead: false,
        inMailboxWrite: false,
        inMailboxHttpRead: false,
        inUserFavorites: false,
        inAppDefaults: false,
        inFastRead: false,
        inNip66Cache: false
      },
      stackFrequency: 0,
      favoritedBy: [],
      reviews: []
    }
    rows.set(url, row)
  }
  row.stackFrequency += 1
  return row
}

/** Merge viewer lists, following favorites, and reviews into one scored directory. */
export function buildExploreRelayDirectory(
  options: BuildExploreRelayDirectoryOptions
): ExploreRelayEntry[] {
  const blocked = normalizeBlocked(options.blockedRelays)
  const rows = new Map<string, MutableRelayRow>()
  const rl = options.relayList

  const touch = (raw: string, patch: Partial<ExploreRelaySourceFlags>) => {
    const row = getOrCreateRow(rows, raw, blocked)
    if (!row) return
    Object.assign(row.flags, patch)
  }

  for (const u of rl?.read ?? []) touch(u, { inMailboxRead: true })
  for (const u of rl?.write ?? []) touch(u, { inMailboxWrite: true })
  for (const u of rl?.httpRead ?? []) touch(u, { inMailboxHttpRead: true })
  for (const u of options.favoriteRelays) touch(u, { inUserFavorites: true })
  for (const u of DEFAULT_FAVORITE_RELAYS) touch(u, { inAppDefaults: true })
  for (const u of FAST_READ_RELAY_URLS) touch(u, { inFastRead: true })
  for (const u of options.nip66CachedUrls ?? []) touch(u, { inNip66Cache: true })

  for (const [raw, pubkeys] of options.followingFavorites ?? []) {
    const row = getOrCreateRow(rows, raw, blocked)
    if (!row) continue
    const seen = new Set(row.favoritedBy)
    for (const pk of pubkeys) {
      if (!pk || seen.has(pk)) continue
      seen.add(pk)
      row.favoritedBy.push(pk)
    }
  }

  for (const [raw, events] of options.reviewsByRelay ?? []) {
    const row = getOrCreateRow(rows, raw, blocked)
    if (!row || !events.length) continue
    row.reviews = [...events]
  }

  const entries: ExploreRelayEntry[] = []
  for (const row of rows.values()) {
    const followingCount = row.favoritedBy.length
    const reviewCount = row.reviews.length
    entries.push({
      url: row.url,
      sourceFlags: row.flags,
      favoritedBy: row.favoritedBy,
      reviews: row.reviews,
      score: scoreExploreRelayEntry(row.flags, followingCount, reviewCount, row.stackFrequency)
    })
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.favoritedBy.length !== a.favoritedBy.length) {
      return b.favoritedBy.length - a.favoritedBy.length
    }
    if (b.reviews.length !== a.reviews.length) return b.reviews.length - a.reviews.length
    return a.url.localeCompare(b.url)
  })

  const max = options.max ?? 200
  return entries.slice(0, max)
}

/** Case-insensitive filter for the directory list (URL / simplified host). */
export function filterExploreRelayDirectory(
  entries: ExploreRelayEntry[],
  rawQuery: string
): ExploreRelayEntry[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => {
    const n = e.url.toLowerCase()
    return n.includes(q) || n.replace(/^wss?:\/\//, '').includes(q)
  })
}
