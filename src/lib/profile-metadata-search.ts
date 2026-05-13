import { splitNip05Identifier } from '@/lib/nip05'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/**
 * Trim, lowercase, and collapse whitespace for case-insensitive profile / NIP-05 matching.
 */
export function normalizeProfileSearchQueryForMatch(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Every `nip05` tag value plus JSON `nip05` (string or string[]). */
export function collectNip05ValuesFromKind0(ev: Event): string[] {
  const set = new Set<string>()
  for (const t of ev.tags ?? []) {
    if (!Array.isArray(t) || t.length < 2) continue
    if (String(t[0]).toLowerCase() !== 'nip05') continue
    for (let i = 1; i < t.length; i++) {
      const v = String(t[i] ?? '').trim()
      if (v) set.add(v)
    }
  }
  try {
    const o = JSON.parse(ev.content || '{}') as Record<string, unknown>
    const n = o.nip05
    if (typeof n === 'string' && n.trim()) set.add(n.trim())
    else if (Array.isArray(n)) {
      for (const x of n) {
        if (typeof x === 'string' && x.trim()) set.add(x.trim())
      }
    }
  } catch {
    /* ignore */
  }
  return [...set]
}

function haystackMatchesNeedle(haystack: string, needle: string, needleNoAt: string): boolean {
  const h = haystack.toLowerCase()
  if (needle && h.includes(needle)) return true
  if (needleNoAt && needleNoAt.length > 0 && h.includes(needleNoAt)) return true
  return false
}

/**
 * True when kind-0 `ev` matches a profile search string: pubkey / npub decode, raw JSON `content`,
 * JSON name / display_name / about, every `nip05` tag, and JSON `nip05` (including multiple values).
 */
export function profileKind0MatchesSearchQuery(ev: Event, rawQuery: string): boolean {
  if (ev.kind !== kinds.Metadata) return false
  const trimmed = rawQuery.trim()
  if (!trimmed) return false

  const decodedPk = decodeProfileSearchQueryToPubkeyHex(trimmed)
  if (decodedPk && ev.pubkey.toLowerCase() === decodedPk) return true

  const needle = normalizeProfileSearchQueryForMatch(trimmed)
  if (!needle) return false
  const needleNoAt = needle.startsWith('@') ? needle.slice(1).trim() : needle

  const pkLower = ev.pubkey.toLowerCase()
  if (pkLower.includes(needle) || (needleNoAt && pkLower.includes(needleNoAt))) return true

  const contentRaw = ev.content ?? ''
  if (haystackMatchesNeedle(contentRaw, needle, needleNoAt)) return true

  for (const nip of collectNip05ValuesFromKind0(ev)) {
    const nl = nip.toLowerCase()
    if (nl === needle || (needleNoAt && nl === needleNoAt)) return true
    if (haystackMatchesNeedle(nip, needle, needleNoAt)) return true
    const sp = splitNip05Identifier(nip)
    if (sp) {
      const compact = `${sp.name}@${sp.domain}`.toLowerCase()
      const spaced = `${sp.name} ${sp.domain}`.toLowerCase()
      if (
        compact.includes(needle) ||
        needle.includes(compact) ||
        spaced.includes(needle) ||
        needle.includes(spaced)
      ) {
        return true
      }
      if (needleNoAt) {
        if (compact.includes(needleNoAt) || spaced.includes(needleNoAt)) return true
      }
    }
  }

  try {
    const profileObj = JSON.parse(ev.content || '{}') as Record<string, unknown>
    const blobs = [
      typeof profileObj.display_name === 'string' ? profileObj.display_name : '',
      typeof profileObj.name === 'string' ? profileObj.name : '',
      typeof profileObj.about === 'string' ? profileObj.about : ''
    ]
    for (const p of blobs) {
      if (haystackMatchesNeedle(p, needle, needleNoAt)) return true
    }
  } catch {
    return false
  }

  return false
}
