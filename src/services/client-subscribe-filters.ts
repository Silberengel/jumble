import { DOCUMENT_RELAY_URLS, relayFilterIncludesDocumentRelayKind } from '@/constants'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { Filter, nip19 } from 'nostr-tools'

const HEX_EVENT_ID_RE = /^[0-9a-f]{64}$/i

function decodeEventRefForETagFilter(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.toLowerCase().startsWith('nostr:') ? trimmed.slice(6).trim() : trimmed
  if (HEX_EVENT_ID_RE.test(withoutPrefix)) return withoutPrefix.toLowerCase()
  try {
    const decoded = nip19.decode(withoutPrefix)
    if (decoded.type === 'note') return decoded.data
    if (decoded.type === 'nevent') return decoded.data.id
  } catch {
    // ignore malformed refs
  }
  return null
}

function sanitizeETagFilterForSubscribe(filter: Filter): Filter | null {
  const f = { ...filter } as Filter & { '#e'?: string[]; '#E'?: string[] }
  const rawLower = Array.isArray(f['#e']) ? f['#e'] : []
  const rawUpper = Array.isArray(f['#E']) ? f['#E'] : []
  if (rawLower.length === 0 && rawUpper.length === 0) return f
  const rawAll = [...rawLower, ...rawUpper]
  const decoded = [
    ...new Set(
      rawAll
        .map((v) => decodeEventRefForETagFilter(String(v)))
        .filter((v): v is string => !!v)
    )
  ]
  if (decoded.length === 0) return null
  f['#e'] = decoded
  delete f['#E']
  return f
}

/** NIP-01 filter keys only; NIP-50 adds `search` which non-searchable relays reject. */
export function filterForRelay(f: Filter, relaySupportsSearch: boolean): Filter {
  if (relaySupportsSearch) return f
  const rest = { ...f }
  delete rest.search
  return rest as Filter
}

export function sanitizeSubscribeFiltersBeforeReq(filter: Filter | Filter[]): Filter[] {
  const asArray = Array.isArray(filter) ? filter : [filter]
  return asArray.map(sanitizeETagFilterForSubscribe).filter((f): f is Filter => !!f)
}

export function withDocumentRelayUrlsForFilters(
  relays: string[],
  filters: Filter[],
  opts?: { singleRelayFeed?: boolean }
): string[] {
  if (opts?.singleRelayFeed) return relays
  if (!filters.some((f) => relayFilterIncludesDocumentRelayKind(f))) return relays
  return dedupeNormalizeRelayUrlsOrdered([...relays, ...DOCUMENT_RELAY_URLS])
}
