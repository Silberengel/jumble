import { normalizeProfileSearchQueryForMatch } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import type { TProfile } from '@/types'

function haystackIncludes(haystack: string, needle: string, needleNoAt: string): boolean {
  const h = haystack.toLowerCase()
  if (needle && h.includes(needle)) return true
  if (needleNoAt.length > 0 && h.includes(needleNoAt)) return true
  return false
}

function searchNeedles(rawQuery: string): { needle: string; needleNoAt: string } | null {
  const trimmed = rawQuery.trim()
  if (!trimmed) return null
  const needle = normalizeProfileSearchQueryForMatch(trimmed)
  if (!needle) return null
  const needleNoAt = needle.startsWith('@') ? needle.slice(1).trim() : needle
  return { needle, needleNoAt }
}

/** Match hex pubkey, npub, or formatted pubkey substring without loaded metadata. */
export function pubkeyMatchesListSearch(pubkey: string, rawQuery: string): boolean {
  const trimmed = rawQuery.trim()
  if (!trimmed) return true

  const decoded = decodeProfileSearchQueryToPubkeyHex(trimmed)
  const pkLower = pubkey.toLowerCase()
  if (decoded && pkLower === decoded) return true

  const needles = searchNeedles(trimmed)
  if (!needles) return true
  const { needle, needleNoAt } = needles

  if (haystackIncludes(pkLower, needle, needleNoAt)) return true

  const npub = pubkeyToNpub(pkLower)
  if (npub && haystackIncludes(npub, needle, needleNoAt)) return true

  if (haystackIncludes(formatPubkey(pkLower), needle, needleNoAt)) return true

  return false
}

/** Match display name (`username`), name (`original_username`), or nip05. */
export function profileMatchesListSearch(profile: TProfile, rawQuery: string): boolean {
  if (!rawQuery.trim()) return true
  if (pubkeyMatchesListSearch(profile.pubkey, rawQuery)) return true

  const needles = searchNeedles(rawQuery)
  if (!needles) return true
  const { needle, needleNoAt } = needles

  const blobs = [
    profile.username,
    profile.original_username,
    profile.nip05,
    ...(profile.nip05List ?? [])
  ].filter(Boolean) as string[]

  for (const b of blobs) {
    if (haystackIncludes(b, needle, needleNoAt)) return true
  }
  return false
}

export function filterPubkeysByListSearch(
  pubkeys: string[],
  profilesByPubkey: Map<string, TProfile>,
  rawQuery: string
): string[] {
  const q = rawQuery.trim()
  if (!q) return pubkeys

  const decoded = decodeProfileSearchQueryToPubkeyHex(q)
  if (decoded) {
    const hit = pubkeys.find((pk) => pk.toLowerCase() === decoded)
    return hit ? [hit] : []
  }

  return pubkeys.filter((pk) => {
    const pkNorm = pk.toLowerCase()
    if (pubkeyMatchesListSearch(pk, q)) return true
    const profile = profilesByPubkey.get(pkNorm)
    return profile ? profileMatchesListSearch(profile, q) : false
  })
}
