/**
 * Expand user-facing identifier paste (URL, scheme id, or slug) into tag queries for
 * wiki (30818) and publication (30040) search.
 *
 * Covers:
 * - URLs → `s` / `source` and also `i` (some publishers put the URL in `i` instead of `s`)
 * - scheme identifiers → `i` (`wikipedia:en:…`, `gutenberg:…`, …)
 * - derived `d` tags (wiki page slug, `pg{id}`, …)
 */

import {
  gutenbergEbookPageUrl,
  parseGutenbergEbookId
} from '@/lib/gutenberg-cover'
import { wikiDTagVariants } from '@/lib/nip54'
import type { Filter } from 'nostr-tools'

export type IdentifierExpanderQuery = {
  /** Candidate `s` / `source` values (usually URLs). */
  s?: string[]
  /** Candidate `i` values — scheme ids and/or URLs (URL-in-`i` publishers). */
  i?: string[]
  /** Candidate `d` tag values. */
  d?: string[]
}

function pack(sVals: string[], iVals: string[], dVals: string[] = []): IdentifierExpanderQuery {
  const s = [...new Set(sVals.filter((v) => v !== ''))]
  const i = [...new Set(iVals.filter((v) => v !== ''))]
  const d = [...new Set(dVals.filter((v) => v !== ''))]
  const out: IdentifierExpanderQuery = {}
  if (s.length > 0) out.s = s
  if (i.length > 0) out.i = i
  if (d.length > 0) out.d = d
  return out
}

export function isIdentifierUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    /^www\./i.test(value) ||
    /^(?:[a-z]{2,3}\.)?(?:wikipedia|gutenberg|openlibrary|wikidata)\.org\//i.test(value)
  )
}

/**
 * True for a pasted URL / scheme id / Gutenberg / ISBN / Wikidata id.
 * Free-text titles (`Mansfield Park`) also expand to `d`/`wikipedia:…` — do not treat those
 * as identifier searches (they fan out `#d`/`#i` that miss Gutenberg `pgNNN-…` slugs).
 */
export function queryLooksLikePastedIdentifier(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (isIdentifierUrl(trimmed)) return true
  if (/^(gutenberg|openlibrary|isbn|wikidata|wikipedia|overdrive):/i.test(trimmed)) return true
  if (/^pg\d+$/i.test(trimmed)) return true
  if (/^\d{1,7}$/.test(trimmed)) return true
  if (/^OL\d+[A-Za-z]?$/i.test(trimmed)) return true
  if (/^Q\d+$/i.test(trimmed)) return true
  const isbnDigits = trimmed.replace(/[\s\-]/g, '')
  return /^978\d{10}$/.test(isbnDigits) || /^\d{9}[\dXx]$/.test(isbnDigits)
}

function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** Drop hash/query so pasted chapter anchors still expand to the ebook / page identity. */
export function urlWithoutHashAndQuery(url: string): string {
  try {
    const uri = new URL(url)
    uri.hash = ''
    uri.search = ''
    return uri.toString().replace(/\/$/, '')
  } catch {
    return url.split('#')[0]?.split('?')[0] ?? url
  }
}

function wikiLangFromHost(url: string): string {
  try {
    const host = new URL(url).hostname
    const m = /^([a-z]{2,3})\.wikipedia\.org$/i.exec(host)
    return m ? m[1].toLowerCase() : 'en'
  } catch {
    return 'en'
  }
}

function dTagFromWikipediaPage(page: string): string[] {
  return wikiDTagVariants(page.replace(/_/g, ' '))
}

function wikipediaIVariants(lang: string, page: string): string[] {
  return [...new Set([`wikipedia:${lang}:${page}`, `wikipedia:${lang}:${page.toLowerCase()}`])]
}

/**
 * Put cleaned URL into both `s` and `i` so `#s` and URL-in-`i` both hit.
 */
function packUrlIdentity(
  urls: string[],
  schemeIds: string[],
  dTags: string[] = []
): IdentifierExpanderQuery {
  const cleanedUrls = [...new Set(urls.map((u) => urlWithoutHashAndQuery(u)).filter(Boolean))]
  return pack(cleanedUrls, [...schemeIds, ...cleanedUrls], dTags)
}

function expandUrl(raw: string): IdentifierExpanderQuery {
  const url = normalizeUrl(raw)
  let host = ''
  let path = ''
  try {
    const uri = new URL(url)
    host = (uri.hostname || '').toLowerCase()
    path = uri.pathname || ''
  } catch {
    return packUrlIdentity([url], [])
  }

  if (host.includes('wikipedia.org')) {
    const cleaned = urlWithoutHashAndQuery(url)
    const m = /\/wiki\/([^?#]+)/i.exec(path)
    if (!m) return packUrlIdentity([cleaned], [])
    const page = decodeURIComponent(m[1])
    const lang = wikiLangFromHost(url)
    return packUrlIdentity([cleaned], wikipediaIVariants(lang, page), dTagFromWikipediaPage(page))
  }

  if (host.includes('gutenberg.org')) {
    const id = parseGutenbergEbookId(url) ?? parseGutenbergEbookId(path)
    if (!id) return packUrlIdentity([url], [])
    const canonical = gutenbergEbookPageUrl(id)
    const cleaned = urlWithoutHashAndQuery(url)
    return packUrlIdentity([canonical, cleaned], [`gutenberg:${id}`], [`pg${id}`, id])
  }

  if (host.includes('openlibrary.org')) {
    const cleaned = urlWithoutHashAndQuery(url)
    const urls = new Set<string>([cleaned])
    const schemeIds: string[] = []
    const dTags: string[] = []

    const work = /\/works\/(OL\d+[A-Za-z]?)/i.exec(path)
    if (work) {
      const ol = work[1].toUpperCase()
      const canonical = `https://openlibrary.org/works/${ol}`
      urls.add(canonical)
      schemeIds.push(`openlibrary:${ol}`, `openlibrary:${ol.toLowerCase()}`)
      dTags.push(ol.toLowerCase(), ol)
      return packUrlIdentity([...urls], schemeIds, dTags)
    }

    // `/books/OL…M` editions; legacy short `/b/OL…M` redirects to the same.
    const book = /\/(?:books|b)\/(OL\d+[A-Za-z]?)/i.exec(path)
    if (book) {
      const ol = book[1].toUpperCase()
      const canonical = ol.endsWith('M')
        ? `https://openlibrary.org/books/${ol}`
        : `https://openlibrary.org/works/${ol}`
      urls.add(canonical)
      schemeIds.push(`openlibrary:${ol}`, `openlibrary:${ol.toLowerCase()}`)
      dTags.push(ol.toLowerCase(), ol)
      return packUrlIdentity([...urls], schemeIds, dTags)
    }

    const isbn = /\/isbn\/([0-9Xx\-]+)/i.exec(path)
    if (isbn) {
      const digits = isbn[1].replace(/[\s\-]/g, '')
      const canonical = `https://openlibrary.org/isbn/${digits}`
      urls.add(canonical)
      schemeIds.push(`isbn:${digits}`)
      if (/^978\d{10}$/.test(digits) || /^\d{9}[\dXx]$/i.test(digits)) {
        // Also bare digit variants for loose catalog tags.
        schemeIds.push(digits)
      }
      return packUrlIdentity([...urls], schemeIds, dTags)
    }

    return packUrlIdentity([cleaned], [])
  }

  if (host.includes('wikidata.org')) {
    const cleaned = urlWithoutHashAndQuery(url)
    const m = /\/wiki\/(Q\d+)/i.exec(path)
    if (!m) return packUrlIdentity([cleaned], [])
    const qid = m[1]
    return packUrlIdentity([cleaned], [`wikidata:${qid}`], [qid.toLowerCase()])
  }

  return packUrlIdentity([url], [])
}

function expandTerm(raw: string): IdentifierExpanderQuery {
  const lower = raw.toLowerCase()

  if (/^(gutenberg|openlibrary|isbn|wikidata|wikipedia|overdrive):/i.test(raw)) {
    const dTags: string[] = []
    const wiki = /^wikipedia:([a-z]{2,3}):(.+)$/i.exec(raw)
    if (wiki) {
      return pack(
        [],
        wikipediaIVariants(wiki[1].toLowerCase(), wiki[2]),
        dTagFromWikipediaPage(wiki[2])
      )
    }
    const gut = /^gutenberg:(\d+)$/i.exec(raw)
    if (gut) dTags.push(`pg${gut[1]}`, gut[1])
    const ol = /^openlibrary:(OL\d+[A-Za-z]?)$/i.exec(raw)
    if (ol) {
      const id = ol[1].toUpperCase()
      const canonical = id.endsWith('M')
        ? `https://openlibrary.org/books/${id}`
        : `https://openlibrary.org/works/${id}`
      return packUrlIdentity(
        [canonical],
        [`openlibrary:${id}`, `openlibrary:${id.toLowerCase()}`],
        [id.toLowerCase(), id]
      )
    }
    return pack([], [raw], dTags)
  }

  if (/^pg\d+$/i.test(raw)) {
    const id = lower.replace(/^pg/, '')
    return pack([], [`gutenberg:${id}`], [`pg${id}`, id, lower])
  }

  if (/^\d{1,7}$/.test(raw)) {
    return pack([], [`gutenberg:${raw}`], [`pg${raw}`, raw])
  }

  if (/^OL\d+[A-Za-z]?$/i.test(raw)) {
    const ol = raw.toUpperCase()
    const canonical = ol.endsWith('M')
      ? `https://openlibrary.org/books/${ol}`
      : `https://openlibrary.org/works/${ol}`
    return packUrlIdentity(
      [canonical],
      [`openlibrary:${ol}`, `openlibrary:${ol.toLowerCase()}`],
      [ol.toLowerCase(), ol]
    )
  }

  if (/^Q\d+$/i.test(raw)) {
    return pack([], [`wikidata:${raw.toUpperCase()}`], [raw.toLowerCase()])
  }

  const isbnDigits = raw.replace(/[\s\-]/g, '')
  if (/^978\d{10}$/.test(isbnDigits) || /^\d{9}[\dXx]$/.test(isbnDigits)) {
    return pack([], [`isbn:${isbnDigits}`])
  }

  // Wikipedia page slug or title (spaces or underscores, optional parens) — also treat as d-tag.
  if (/^[A-Za-z0-9].*[_\s(]/.test(raw) || /^[A-Za-z][\w()'!.\-]+$/.test(raw)) {
    const page = raw.trim().replace(/ /g, '_')
    return pack([], wikipediaIVariants('en', page), [
      ...dTagFromWikipediaPage(page),
      ...wikiDTagVariants(raw)
    ])
  }

  // Hyphenated slug / accented title → d-tag variants only.
  const asD = wikiDTagVariants(raw)
  if (asD.length > 0) return pack([], [], asD)

  return pack([], [])
}

/** Expand a pasted identifier into `{ s?, i?, d? }` (keys omitted when empty). */
export function expandIdentifier(raw: string): IdentifierExpanderQuery {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return {}
  return isIdentifierUrl(trimmed) ? expandUrl(trimmed) : expandTerm(trimmed)
}

export function identifierExpansionIsEmpty(expanded: IdentifierExpanderQuery): boolean {
  return !expanded.i?.length && !expanded.s?.length && !expanded.d?.length
}

/** Normalize a URL needle for equality checks (strip hash/query, lowercase, no trailing slash). */
function normalizeUrlNeedle(value: string): string {
  return urlWithoutHashAndQuery(value).toLowerCase().replace(/\/$/, '')
}

/**
 * True when an event's `i` / `s` / `source` / `d` matches the expansion.
 * URLs match whether stored on `s`, `source`, or `i`.
 */
export function eventMatchesExpandedIdentifier(
  event: { tags?: string[][] },
  expanded: IdentifierExpanderQuery
): boolean {
  if (identifierExpansionIsEmpty(expanded)) return false

  const urlNeedles = new Set<string>()
  const idNeedles = new Set<string>()
  const dNeedles = new Set((expanded.d ?? []).map((v) => v.toLowerCase()))

  for (const v of [...(expanded.s ?? []), ...(expanded.i ?? [])]) {
    if (isIdentifierUrl(v) || /^https?:\/\//i.test(v)) {
      urlNeedles.add(normalizeUrlNeedle(v))
    } else {
      idNeedles.add(v.toLowerCase())
    }
  }

  const gutenbergIds: string[] = []
  const openLibraryIds: string[] = []
  for (const i of expanded.i ?? []) {
    const gut = /^gutenberg:(\d+)$/i.exec(i)
    if (gut) gutenbergIds.push(gut[1])
    const ol = /^openlibrary:(OL\d+[A-Za-z]?)$/i.exec(i)
    if (ol) openLibraryIds.push(ol[1].toUpperCase())
  }

  for (const tag of event.tags ?? []) {
    const name = (tag[0] || '').trim().toLowerCase()
    const val = (tag[1] || '').trim()
    if (!val) continue
    const lower = val.toLowerCase()

    if (name === 'd' && dNeedles.has(lower)) return true

    if (name === 'i' || name === 's' || name === 'source') {
      if (idNeedles.has(lower)) return true
      if (urlNeedles.has(normalizeUrlNeedle(val))) return true

      // Wikipedia path soft-match across s/source/i.
      for (const i of expanded.i ?? []) {
        const m = /^wikipedia:([a-z]{2,3}):(.+)$/i.exec(i)
        if (!m) continue
        const page = m[2]
        if (
          lower.includes(`/wiki/${page}`.toLowerCase()) ||
          lower.includes(`/wiki/${page.toLowerCase()}`)
        ) {
          return true
        }
      }

      for (const id of gutenbergIds) {
        if (
          lower === `gutenberg:${id}` ||
          lower.startsWith(`pg${id}`) ||
          lower.includes(`/ebooks/${id}`) ||
          lower.includes(`/files/${id}/`) ||
          lower.includes(`/cache/epub/${id}/`)
        ) {
          return true
        }
      }

      for (const ol of openLibraryIds) {
        const olLower = ol.toLowerCase()
        if (
          lower === `openlibrary:${olLower}` ||
          lower.includes(`/works/${olLower}`) ||
          lower.includes(`/books/${olLower}`) ||
          lower.includes(`/b/${olLower}`)
        ) {
          return true
        }
      }
    }

    if (name === 'd' && gutenbergIds.some((id) => lower === `pg${id}` || lower.startsWith(`pg${id}-`))) {
      return true
    }
    if (name === 'd' && openLibraryIds.some((ol) => lower === ol.toLowerCase() || lower.includes(ol.toLowerCase()))) {
      return true
    }
  }
  return false
}

/**
 * NIP-01 filters for identifier search on wiki or publication kinds.
 * Emits `#i` (scheme ids + URLs), `#s` (URLs), and `#d` when present.
 */
export function buildIdentifierSearchFilters(
  expanded: IdentifierExpanderQuery,
  kind: number,
  limit: number
): Filter[] {
  if (identifierExpansionIsEmpty(expanded)) return []
  const lim = Math.max(1, Math.min(limit, 100))
  const filters: Filter[] = []
  const seen = new Set<string>()
  const add = (filter: Filter) => {
    const key = JSON.stringify(filter)
    if (seen.has(key)) return
    seen.add(key)
    filters.push(filter)
  }

  // URLs belong in both `#i` and `#s` — publishers differ on which tag they use.
  // Do not emit `#source`: Mercury rejects multi-letter filter keys (400), and stripping
  // it would widen to a kinds-only query.
  const iVals = [...new Set([...(expanded.i ?? []), ...(expanded.s ?? [])])]
  const sVals = [...new Set(expanded.s ?? [])]
  const dVals = [...new Set(expanded.d ?? [])]

  if (iVals.length > 0) add({ kinds: [kind], '#i': iVals, limit: lim } as Filter)
  if (sVals.length > 0) {
    add({ kinds: [kind], '#s': sVals, limit: lim } as Filter)
  }
  if (dVals.length > 0) add({ kinds: [kind], '#d': dVals, limit: lim })

  return filters
}
