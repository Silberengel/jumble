import { METADATA_CO_FETCH_KINDS } from '@/constants'
import type { Filter } from 'nostr-tools'
import { splitNip05Identifier } from '@/lib/nip05'
import { normalizeProfileSearchQueryForMatch } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'

/**
 * REQ filters for kind 0 profile discovery: NIP-50 `search` plus tag-shaped queries
 * (`#nip05`, `#name`, `#display_name`) that profile mirrors often index.
 * When the query is a hex pubkey, `npub`, or `nprofile`, relays are queried by `authors`
 * (NIP-50 text search does not match raw hex or bech32).
 * Multiple filters are OR‑merged by relays.
 */
export function buildProfileKind0SearchFilters(opts: {
  search: string
  limit: number
  until?: number
}): Filter[] {
  const searchRaw = opts.search.trim()
  if (!searchRaw) return []

  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const time =
    typeof opts.until === 'number' && opts.until > 0 ? ({ until: opts.until } as Pick<Filter, 'until'>) : {}
  const k = [...METADATA_CO_FETCH_KINDS] as number[]

  const pubkeyHex = decodeProfileSearchQueryToPubkeyHex(searchRaw)
  if (pubkeyHex) {
    return [{ kinds: k, authors: [pubkeyHex], limit, ...time }]
  }

  const searchNorm = normalizeProfileSearchQueryForMatch(searchRaw)

  const seen = new Set<string>()
  const out: Filter[] = []
  const add = (f: Filter) => {
    const key = JSON.stringify(f)
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }

  add({ kinds: k, search: searchRaw, limit, ...time })
  if (searchNorm.length > 0 && searchNorm !== searchRaw) {
    add({ kinds: k, search: searchNorm, limit, ...time })
  }

  if (searchRaw.includes('@')) {
    const firstToken = (searchRaw.split(/\s+/)[0] ?? searchRaw).trim()
    const nipVariants = new Set<string>()
    if (firstToken) {
      nipVariants.add(firstToken.toLowerCase())
      nipVariants.add(firstToken)
    }
    if (searchNorm) nipVariants.add(searchNorm)
    const sp = splitNip05Identifier(firstToken)
    if (sp) {
      nipVariants.add(`${sp.name}@${sp.domain}`.toLowerCase())
      nipVariants.add(`${sp.name}@${sp.domain}`)
    }
    for (const v of nipVariants) {
      if (!v) continue
      add({ kinds: k, '#nip05': [v], limit, ...time })
    }
  }

  const token = searchRaw.startsWith('@') ? searchRaw.slice(1).trim() : searchRaw.trim()
  if (
    token &&
    !/\s/.test(token) &&
    token.length <= 80 &&
    /^[a-zA-Z0-9._-]+$/.test(token) &&
    !token.includes('@')
  ) {
    add({ kinds: k, '#name': [token], limit, ...time })
    add({ kinds: k, '#display_name': [token], limit, ...time })
  }

  return out
}
