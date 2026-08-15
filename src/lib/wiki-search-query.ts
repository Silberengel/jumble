/**
 * Derive NIP-54 wiki search needles from a user query — plain title, d-tag, or pasted URL / i-tag.
 */

import {
  buildIdentifierSearchFilters,
  eventMatchesExpandedIdentifier,
  expandIdentifier,
  type IdentifierExpanderQuery
} from '@/lib/identifier-expander'
import { wikiDTagVariants } from '@/lib/nip54'
import type { Event, Filter } from 'nostr-tools'
import { ExtendedKind } from '@/constants'

export type WikiSearchQueryPlan = {
  /** Original trimmed query (for ranking / display). */
  raw: string
  expanded: IdentifierExpanderQuery
  /** `#d` values to REQ (never a mangled full URL). */
  dTags: string[]
  /** Title / `#T` needles (human page title + underscore form). */
  titleNeedles: string[]
  /** Body/metadata text queries for Mercury + local + NIP-50 (page title, not the raw URL). */
  textQueries: string[]
}

function wikipediaPageFromIdentifier(i: string): { lang: string; page: string } | null {
  const m = /^wikipedia:([a-z]{2,3}):(.+)$/i.exec(i.trim())
  if (!m) return null
  return { lang: m[1].toLowerCase(), page: m[2] }
}

/**
 * Build search needles for wiki (kind 30818) lookup.
 * Wikipedia / identifier URLs expand to page title + d-tag + `i`/`s` (URLs also queried as `#i`).
 */
export function planWikiSearchQuery(raw: string): WikiSearchQueryPlan {
  const q = raw.trim()
  const expanded = expandIdentifier(q)
  const dTags = new Set<string>(expanded.d ?? [])
  const titleNeedles = new Set<string>()
  const textQueries = new Set<string>()

  let fromStructuredId = false
  for (const id of expanded.i ?? []) {
    const parsed = wikipediaPageFromIdentifier(id)
    if (!parsed) continue
    fromStructuredId = true
    const spaced = parsed.page.replace(/_/g, ' ').trim()
    if (spaced) {
      titleNeedles.add(spaced)
      textQueries.add(spaced)
    }
    if (parsed.page) titleNeedles.add(parsed.page)
    for (const d of wikiDTagVariants(spaced || parsed.page)) dTags.add(d)
  }

  if (expanded.s?.length || expanded.i?.length || expanded.d?.length) {
    fromStructuredId = true
  }

  if (!fromStructuredId) {
    for (const d of wikiDTagVariants(q)) dTags.add(d)
    if (q) textQueries.add(q)
  } else if (textQueries.size === 0 && q && !/^https?:\/\//i.test(q)) {
    textQueries.add(q)
  }

  return {
    raw: q,
    expanded,
    dTags: [...dTags],
    titleNeedles: [...titleNeedles],
    textQueries: [...textQueries]
  }
}

/** NIP-01 filters for wiki identifier / URL / d-tag lookup from a plan. */
export function wikiIdentifierFiltersFromPlan(plan: WikiSearchQueryPlan, limit: number): Filter[] {
  const merged: IdentifierExpanderQuery = {
    ...plan.expanded,
    d: [...new Set([...(plan.expanded.d ?? []), ...plan.dTags])]
  }
  return buildIdentifierSearchFilters(merged, ExtendedKind.WIKI_ARTICLE, limit)
}

/** Keep a wiki event if it matches the plan via identifier, d-tag, title, or text. */
export function wikiEventMatchesSearchPlan(
  event: Event,
  plan: WikiSearchQueryPlan,
  textMatch: (event: Event, query: string) => boolean
): boolean {
  const expandedWithD: IdentifierExpanderQuery = {
    ...plan.expanded,
    d: [...new Set([...(plan.expanded.d ?? []), ...plan.dTags])]
  }
  if (eventMatchesExpandedIdentifier(event, expandedWithD)) return true
  for (const dTag of plan.dTags) {
    if (event.tags.some((tg) => tg[0] === 'd' && (tg[1] || '').toLowerCase() === dTag.toLowerCase())) {
      return true
    }
  }
  for (const title of plan.titleNeedles) {
    const lower = title.toLowerCase()
    if (
      event.tags.some(
        (tg) =>
          (tg[0] === 'T' || tg[0] === 'title') &&
          typeof tg[1] === 'string' &&
          tg[1].toLowerCase().includes(lower)
      )
    ) {
      return true
    }
  }
  for (const text of plan.textQueries) {
    if (textMatch(event, text)) return true
  }
  return false
}
