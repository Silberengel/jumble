import { isValidPubkey, userIdToPubkey } from '@/lib/pubkey'
import { resolveHttpMediaUrl } from '@/lib/badge-definition-media'

/** Normalize a NIP-58 badge definition `d` tag (unique badge id). */
export function normalizeBadgeDTag(input: string): string {
  const lowered = input.normalize('NFC').toLowerCase().trim()
  let out = ''
  for (const ch of lowered) {
    if (/\s/u.test(ch) || ch === '_') {
      out += '-'
    } else if (ch === '-') {
      out += '-'
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch
    }
  }
  return out.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Parse recipient pubkeys from free text (npub / nprofile / hex),
 * split on commas, whitespace, or newlines.
 */
export function parseBadgeRecipientPubkeys(raw: string): {
  pubkeys: string[]
  invalidTokens: string[]
} {
  const tokens = raw
    .split(/[\s,;]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
  const pubkeys: string[] = []
  const seen = new Set<string>()
  const invalidTokens: string[] = []
  for (const token of tokens) {
    const pk = userIdToPubkey(token)
    if (!isValidPubkey(pk)) {
      invalidTokens.push(token)
      continue
    }
    const hex = pk.toLowerCase()
    if (seen.has(hex)) continue
    seen.add(hex)
    pubkeys.push(hex)
  }
  return { pubkeys, invalidTokens }
}

export function buildBadgeDefinitionTags(options: {
  d: string
  name?: string
  description?: string
  imageUrl?: string
  thumbUrl?: string
}): string[][] {
  const d = normalizeBadgeDTag(options.d)
  if (!d) throw new Error('Badge id (d tag) is required')

  const tags: string[][] = [['d', d]]
  const name = options.name?.trim()
  if (name) tags.push(['name', name])
  const description = options.description?.trim()
  if (description) tags.push(['description', description])

  const image = resolveHttpMediaUrl(options.imageUrl)
  if (image) tags.push(['image', image])
  const thumb = resolveHttpMediaUrl(options.thumbUrl) ?? image
  if (thumb) tags.push(['thumb', thumb])

  return tags
}

export function badgeDefinitionCoordinate(issuerPubkey: string, d: string): string {
  const id = normalizeBadgeDTag(d)
  return `30009:${issuerPubkey.toLowerCase()}:${id}`
}
