import nostrArchivesApi from '@/services/nostr-archives-api.service'
import type { TSearchParams } from '@/types'
import { nip19 } from 'nostr-tools'

function decodeNip19Id(raw: string): TSearchParams | null {
  let id = raw.trim()
  if (!id) return null
  if (id.startsWith('nostr:')) id = id.slice(6)
  try {
    const { type } = nip19.decode(id)
    if (type === 'npub' || type === 'nprofile') {
      return { type: 'profile', search: id }
    }
    if (type === 'nevent' || type === 'naddr' || type === 'note') {
      return { type: 'note', search: id }
    }
  } catch {
    // not bech32
  }
  return null
}

/** Map Archives `GET /v1/search` `resolved` payload to in-app search navigation. */
export function archivesSearchResolvedToParams(
  resolved: unknown,
  fallbackQuery?: string
): TSearchParams | null {
  if (resolved == null) return null

  if (typeof resolved === 'string') {
    const trimmed = resolved.trim()
    const fromBech32 = decodeNip19Id(trimmed)
    if (fromBech32) return fromBech32
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return { type: 'note', search: trimmed.toLowerCase() }
    }
    return null
  }

  if (typeof resolved !== 'object') return null
  const o = resolved as Record<string, unknown>

  const typeRaw = String(o.type ?? o.kind ?? o.entity_type ?? '').toLowerCase()
  const idRaw = String(
    o.id ?? o.identifier ?? o.ref ?? o.bech32 ?? o.npub ?? o.note_id ?? o.event_id ?? ''
  ).trim()

  if (typeRaw === 'profile' || typeRaw === 'npub' || typeRaw === 'nprofile' || typeRaw === '0') {
    const pubkey = String(o.pubkey ?? o.author ?? idRaw).trim()
    if (/^[0-9a-f]{64}$/i.test(pubkey)) {
      try {
        return { type: 'profile', search: nip19.npubEncode(pubkey) }
      } catch {
        return { type: 'profile', search: pubkey.toLowerCase() }
      }
    }
    const fromBech32 = decodeNip19Id(idRaw || pubkey)
    if (fromBech32?.type === 'profile') return fromBech32
  }

  if (
    typeRaw === 'note' ||
    typeRaw === 'event' ||
    typeRaw === 'nevent' ||
    typeRaw === 'naddr' ||
    typeRaw === 'note1' ||
    typeRaw === '1'
  ) {
    if (/^[0-9a-f]{64}$/i.test(idRaw)) {
      return { type: 'note', search: idRaw.toLowerCase() }
    }
    const fromBech32 = decodeNip19Id(idRaw)
    if (fromBech32?.type === 'note') return fromBech32
  }

  const embedded = o.event
  if (embedded && typeof embedded === 'object') {
    const ev = embedded as Record<string, unknown>
    const evId = String(ev.id ?? '').trim()
    if (/^[0-9a-f]{64}$/i.test(evId)) {
      return { type: 'note', search: evId.toLowerCase() }
    }
  }

  const pubkeyOnly = String(o.pubkey ?? '').trim()
  if (/^[0-9a-f]{64}$/i.test(pubkeyOnly)) {
    try {
      return { type: 'profile', search: nip19.npubEncode(pubkeyOnly) }
    } catch {
      return { type: 'profile', search: pubkeyOnly.toLowerCase() }
    }
  }

  if (idRaw) {
    const fromBech32 = decodeNip19Id(idRaw)
    if (fromBech32) return fromBech32
    if (/^[0-9a-f]{64}$/i.test(idRaw)) {
      return { type: 'note', search: idRaw.toLowerCase() }
    }
  }

  if (fallbackQuery) {
    const q = fallbackQuery.trim()
    const fromBech32 = decodeNip19Id(q)
    if (fromBech32) return fromBech32
    if (/^[0-9a-f]{64}$/i.test(q)) {
      return { type: 'note', search: q.toLowerCase() }
    }
  }

  return null
}

/** When Archives resolves a Nostr entity, returns direct navigation params (or null). */
export async function tryResolveSearchViaArchives(query: string): Promise<TSearchParams | null> {
  const q = query.trim()
  if (!q || !nostrArchivesApi.isAvailable()) return null

  const res = await nostrArchivesApi.searchGeneral({ q, type: 'all', limit: 1 })
  if (!res.ok || res.data.resolved == null) return null

  return archivesSearchResolvedToParams(res.data.resolved, q)
}

export function isAmbiguousHexSearchQuery(query: string): boolean {
  return /^[0-9a-f]{64}$/i.test(query.trim())
}

/** Prefer Archives resolution for ambiguous 64-char hex before defaulting to note/profile rows. */
export function pickArchivesResolvedOverHexDefault(
  resolved: TSearchParams,
  userChoice: TSearchParams
): TSearchParams {
  if (!isAmbiguousHexSearchQuery(userChoice.search)) return userChoice
  if (resolved.type === 'profile' || resolved.type === 'note') return resolved
  return userChoice
}
