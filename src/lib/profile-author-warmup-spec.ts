import { FAST_READ_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import type { TSubRequestFilter } from '@/types'
import { normalizeHexPubkey } from '@/lib/pubkey'
import type { Filter } from 'nostr-tools'

/** Profile Posts/Media tabs pass stable keys like `profile-posts-…` / `profile-media-…`. */
export function isProfileTimelineSubscriptionKey(key: string | undefined | null): boolean {
  return typeof key === 'string' && key.startsWith('profile-')
}

/**
 * Profile feeds may include calendar invite shards (`#p`) without `authors`. Local session/IDB
 * warmup and relay fallback only need the single-author + kinds REQ shards.
 */
export function getProfileAuthorWarmupSpec(
  mapped: Array<{ urls: string[]; filter: TSubRequestFilter }>
): { author: string; kinds: number[] } | null {
  const authorShards = mapped.filter((m) => {
    const authors = (m.filter as Filter).authors
    return Array.isArray(authors) && authors.length === 1
  })
  if (authorShards.length === 0) return null

  let normAuthor: string | null = null
  const kindUnion = new Set<number>()

  for (const { filter: f } of authorShards) {
    const authors = (f as Filter).authors!
    let pk: string
    try {
      pk = normalizeHexPubkey(authors[0]!)
    } catch {
      return null
    }
    if (normAuthor === null) normAuthor = pk
    else if (normAuthor !== pk) return null

    const ks = (f as Filter).kinds
    if (!Array.isArray(ks) || ks.length === 0) return null
    for (const k of ks) kindUnion.add(k)
  }

  if (normAuthor === null || kindUnion.size === 0) return null
  return { author: normAuthor, kinds: Array.from(kindUnion).sort((a, b) => a - b) }
}

/** Relay URLs from author shards only (for profile one-shot fetch). */
export function getProfileAuthorWarmupRelayUrls(
  mapped: Array<{ urls: string[]; filter: TSubRequestFilter }>
): string[] {
  const authorShards = mapped.filter((m) => {
    const authors = (m.filter as Filter).authors
    return Array.isArray(authors) && authors.length === 1
  })
  const seen = new Set<string>()
  const out: string[] = []
  for (const shard of authorShards) {
    for (const u of shard.urls) {
      if (!u || seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

/** Bounded relay stack for profile timeline fetch / fallback (shard URLs + fast-read + profile index). */
export function getProfileTimelineFetchRelayUrls(
  mapped: Array<{ urls: string[]; filter: TSubRequestFilter }>,
  maxRelays = 24
): string[] {
  return dedupeNormalizeRelayUrlsOrdered([
    ...getProfileAuthorWarmupRelayUrls(mapped),
    ...FAST_READ_RELAY_URLS,
    ...PROFILE_RELAY_URLS
  ]).slice(0, maxRelays)
}
