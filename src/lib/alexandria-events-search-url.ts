import { normalizeToDTag, parseAdvancedSearch } from '@/lib/search-parser'
import type { TSearchParams } from '@/types'
import { nip19 } from 'nostr-tools'

export const ALEXANDRIA_NEXT_EVENTS_BASE = 'https://next-alexandria.gitcitadel.eu/events'

const NIP05_STANDALONE = /^\s*[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*$/

/** `id` query for Alexandria: hex for note/nevent; full bech32 for naddr. */
function nip19ToAlexandriaIdValue(bech32Input: string): string | null {
  try {
    let id = bech32Input.trim()
    if (id.startsWith('nostr:')) id = id.slice(6)
    const decoded = nip19.decode(id)
    if (decoded.type === 'note' || decoded.type === 'nevent') {
      const d = decoded.data as string | { id: string }
      const hex = typeof d === 'string' ? d : d.id
      return hex ? hex.toLowerCase() : null
    }
    if (decoded.type === 'naddr') {
      return id
    }
    return null
  } catch {
    return null
  }
}

/**
 * Maps a free-form “notes” / NIP-50 style query to Alexandria `/events` query params
 * (`d`, `t`, `n`, `q`, `id`) per https://next-alexandria.gitcitadel.eu/events.
 */
export function buildAlexandriaEventsSearchUrlFromNotesQuery(query: string): string | null {
  const q = query.trim()
  if (!q) return null

  const lower = q.toLowerCase()

  if (lower.startsWith('d:')) {
    const inner = q.slice(2).trim()
    const d = normalizeToDTag(inner) || inner.toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
    if (!d) return null
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?d=${encodeURIComponent(d)}`
  }

  if (lower.startsWith('t:')) {
    const inner = q.slice(2).trim().toLowerCase()
    if (!inner) return null
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?t=${encodeURIComponent(inner)}`
  }

  if (lower.startsWith('n:')) {
    const inner = q.slice(2).trim()
    if (!inner) return null
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?n=${encodeURIComponent(inner)}`
  }

  if (q.startsWith('#')) {
    const inner = q.slice(1).trim().toLowerCase()
    if (!inner) return null
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?t=${encodeURIComponent(inner)}`
  }

  if (/^[0-9a-f]{64}$/i.test(q)) {
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?id=${encodeURIComponent(q.toLowerCase())}`
  }

  const nip19Id = nip19ToAlexandriaIdValue(q)
  if (nip19Id) {
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?id=${encodeURIComponent(nip19Id)}`
  }

  if (NIP05_STANDALONE.test(q)) {
    return `${ALEXANDRIA_NEXT_EVENTS_BASE}?q=${encodeURIComponent(q.trim())}`
  }

  const adv = parseAdvancedSearch(q)
  if (adv.hashtag) {
    const raw = Array.isArray(adv.hashtag) ? adv.hashtag[0] : adv.hashtag
    const tag = raw?.toString().trim().toLowerCase()
    if (tag) return `${ALEXANDRIA_NEXT_EVENTS_BASE}?t=${encodeURIComponent(tag)}`
  }

  return `${ALEXANDRIA_NEXT_EVENTS_BASE}?q=${encodeURIComponent(q)}`
}

/** Map any in-app search route to a matching Alexandria `/events` URL (empty-state CTA). */
export function buildAlexandriaEventsSearchUrlForTSearchParams(params: TSearchParams): string | null {
  const search = params.search?.trim()
  if (!search) return null

  switch (params.type) {
    case 'hashtag':
      return buildAlexandriaEventsUrlForHashtagParam(search)
    case 'profile':
    case 'profiles': {
      let n = search
      if (n.toLowerCase().startsWith('n:')) n = n.slice(2).trim()
      if (!n) return null
      return `${ALEXANDRIA_NEXT_EVENTS_BASE}?n=${encodeURIComponent(n)}`
    }
    case 'notes':
    case 'note':
      return buildAlexandriaEventsSearchUrlFromNotesQuery(search)
    case 'dtag':
      return buildAlexandriaEventsUrlForDTagParam(search)
    case 'relay':
      return `${ALEXANDRIA_NEXT_EVENTS_BASE}?q=${encodeURIComponent(search)}`
    default:
      return buildAlexandriaEventsSearchUrlFromNotesQuery(search)
  }
}

export function buildAlexandriaEventsUrlForHashtagParam(tag: string): string | null {
  const t = tag.trim().toLowerCase()
  if (!t) return null
  return `${ALEXANDRIA_NEXT_EVENTS_BASE}?t=${encodeURIComponent(t)}`
}

export function buildAlexandriaEventsUrlForDTagParam(d: string): string | null {
  const v = d.trim()
  if (!v) return null
  const normalized = normalizeToDTag(v) || v
  return `${ALEXANDRIA_NEXT_EVENTS_BASE}?d=${encodeURIComponent(normalized)}`
}
