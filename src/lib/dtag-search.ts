import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

function getDTagValue(event: Event): string | undefined {
  const t = event.tags.find((x) => x[0] === 'd' && x[1])?.[1]
  return t
}

/** Collapse spaces / underscores / hyphens so "Halle Berry" ranks equal to `halle-berry`. */
export function normalizeDTagNeedle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Index-identifying slugs for ranking: NIP-54 `d`, Mercury title `T`, author `N`.
 * Multi-letter `title`/`author` are display-only and must not outrank these.
 */
function indexSlugTagValues(event: Event): string[] {
  const out: string[] = []
  for (const tag of event.tags) {
    if ((tag[0] === 'd' || tag[0] === 'T' || tag[0] === 'N') && tag[1]?.trim()) out.push(tag[1])
  }
  return out
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

  const nSlug = normalizeDTagNeedle(needle)
  const dSlug = normalizeDTagNeedle(d)
  if (nSlug && dSlug.includes(nSlug)) return true

  // Hyphen/space-equivalent: collapse both the query and the d-tag to a common separator form.
  const variants = new Set([q, q.replace(/-/g, ' '), q.replace(/\s+/g, '-')])
  for (const v of variants) {
    if (d.includes(v)) return true
  }
  return false
}

/**
 * Sort key for `d` / `T` vs the query (hyphen/space-normalized):
 * 0 exact · 1 prefix · 2 substring · 3 slug present but unrelated · 4 no `d`/`T`.
 *
 * Content-only hits land in 3/4 and must never outrank an exact `d`/`T` match on `created_at`.
 */
function indexSlugMatchRank(needle: string, slugVal: string | undefined): number {
  if (!slugVal) return 4
  const nl = normalizeDTagNeedle(needle)
  const dl = normalizeDTagNeedle(slugVal)
  if (!nl || !dl) return 4
  if (dl === nl) return 0
  if (dl.startsWith(nl)) return 1
  if (dl.includes(nl)) return 2
  return 3
}

/** Best `d`/`T`/`N` match tier for `needle` (0 = exact slug). Exported for publication search sort. */
export function bestIndexSlugMatchRank(needle: string, event: Event): number {
  const slugs = indexSlugTagValues(event)
  if (slugs.length === 0) return 4
  let best = 4
  for (const slug of slugs) {
    const r = indexSlugMatchRank(needle, slug)
    if (r < best) best = r
  }
  return best
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

/** For merged lists: better `d`/`T` match first; tie-break newest first. Kind 30041 sinks unless `d` equals the needle. */
export function compareEventsForDTagQuery(needle: string, a: Event, b: Event): number {
  const nSlug = normalizeDTagNeedle(needle)
  const ra = bestIndexSlugMatchRank(needle, a)
  const rb = bestIndexSlugMatchRank(needle, b)

  if (nSlug.length > 0) {
    const kCh = ExtendedKind.PUBLICATION_CONTENT
    const aExact = normalizeDTagNeedle(getDTagValue(a) || '') === nSlug
    const bExact = normalizeDTagNeedle(getDTagValue(b) || '') === nSlug
    const aBottom = a.kind === kCh && !aExact
    const bBottom = b.kind === kCh && !bExact
    if (aBottom !== bBottom) return aBottom ? 1 : -1
  }

  if (ra !== rb) return ra - rb
  return b.created_at - a.created_at
}
