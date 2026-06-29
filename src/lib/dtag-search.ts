import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

function getDTagValue(event: Event): string | undefined {
  const t = event.tags.find((x) => x[0] === 'd' && x[1])?.[1]
  return t
}

/**
 * A d-tag search must only surface events whose **`d` tag** contains the needle — never events
 * that merely mention the needle in their `content` or metadata tags (title/summary/…). So
 * searching "istanbul" returns the `d` tags `istanbul`, `new-istanbul`, and `istanbul-3`, but not
 * an article whose body happens to discuss Istanbul.
 *
 * Matching is case-insensitive and treats hyphens and spaces as equivalent, so a query entered as
 * "quantum mechanics" matches the NIP-54 slug `quantum-mechanics` (and vice versa).
 */
export function eventMatchesDTagQuery(needle: string, event: Event): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true

  const d = getDTagValue(event)?.toLowerCase()
  if (!d) return false

  // Hyphen/space-equivalent: collapse both the query and the d-tag to a common separator form.
  const variants = new Set([q, q.replace(/-/g, ' '), q.replace(/\s+/g, '-')])
  for (const v of variants) {
    if (d.includes(v)) return true
  }
  return false
}

/** Sort key: exact d-tag match first, then prefix, substring, then non-d / content-only. */
function dTagMatchRank(needle: string, dVal: string | undefined): number {
  if (!dVal) return 4
  const nl = needle.trim().toLowerCase()
  const dl = dVal.toLowerCase()
  if (dl === nl) return 0
  if (dl.startsWith(nl)) return 1
  if (dl.includes(nl)) return 2
  return 3
}

/** Merged general search: device cache/archive hits before relay-only hits; then {@link compareEventsForDTagQuery}. */
export function compareMergedGeneralSearchHits(
  needle: string,
  a: { event: Event; fromLocalArchive?: boolean },
  b: { event: Event; fromLocalArchive?: boolean }
): number {
  const aTier = a.fromLocalArchive ? 0 : 1
  const bTier = b.fromLocalArchive ? 0 : 1
  if (aTier !== bTier) return aTier - bTier
  return compareEventsForDTagQuery(needle, a.event, b.event)
}

/**
 * Like {@link compareEventsForDTagQuery} but floats events of `priorityKind` to the very top
 * (used by wikilinks, which target NIP-54 wiki pages → kind 30818). Within each tier the normal
 * d-tag-match ordering applies.
 */
export function compareEventsForDTagQueryWithPriorityKind(
  needle: string,
  priorityKind: number,
  a: Event,
  b: Event
): number {
  const aTier = a.kind === priorityKind ? 0 : 1
  const bTier = b.kind === priorityKind ? 0 : 1
  if (aTier !== bTier) return aTier - bTier
  return compareEventsForDTagQuery(needle, a, b)
}

/** For merged lists: better d-tag match first; tie-break newest first. Kind 30041 sinks unless `d` equals the needle. */
export function compareEventsForDTagQuery(needle: string, a: Event, b: Event): number {
  const nl = needle.trim().toLowerCase()
  const ra = dTagMatchRank(needle, getDTagValue(a))
  const rb = dTagMatchRank(needle, getDTagValue(b))

  if (nl.length > 0) {
    const kCh = ExtendedKind.PUBLICATION_CONTENT
    const aExact = getDTagValue(a)?.toLowerCase() === nl
    const bExact = getDTagValue(b)?.toLowerCase() === nl
    const aBottom = a.kind === kCh && !aExact
    const bBottom = b.kind === kCh && !bExact
    if (aBottom !== bBottom) return aBottom ? 1 : -1
  }

  if (ra !== rb) return ra - rb
  return b.created_at - a.created_at
}
