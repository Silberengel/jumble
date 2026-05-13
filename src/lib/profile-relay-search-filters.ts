import type { Filter } from 'nostr-tools'
import { kinds } from 'nostr-tools'
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
  const search = opts.search.trim()
  if (!search) return []

  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const time =
    typeof opts.until === 'number' && opts.until > 0 ? ({ until: opts.until } as Pick<Filter, 'until'>) : {}
  const k = [kinds.Metadata] as number[]

  const pubkeyHex = decodeProfileSearchQueryToPubkeyHex(search)
  if (pubkeyHex) {
    return [{ kinds: k, authors: [pubkeyHex], limit, ...time }]
  }

  const seen = new Set<string>()
  const out: Filter[] = []
  const add = (f: Filter) => {
    const key = JSON.stringify(f)
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }

  add({ kinds: k, search, limit, ...time })

  if (search.includes('@')) {
    const firstToken = search.split(/\s+/)[0] ?? search
    const nipLower = firstToken.trim().toLowerCase()
    if (nipLower) add({ kinds: k, '#nip05': [nipLower], limit, ...time })
    const nipExact = firstToken.trim()
    if (nipExact && nipExact !== nipLower) add({ kinds: k, '#nip05': [nipExact], limit, ...time })
  }

  const token = search.startsWith('@') ? search.slice(1).trim() : search.trim()
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
