import { ExtendedKind } from '@/constants'
import { extractBadgeDefinitionMedia } from '@/lib/badge-definition-media'
import { hexPubkeysEqual, isValidPubkey, normalizeHexPubkey } from '@/lib/pubkey'
import { tagNameEquals } from '@/lib/tag'
import { Event, kinds } from 'nostr-tools'

/** Legacy NIP-58 profile badges addressable `d` tag value. */
export const LEGACY_PROFILE_BADGES_D_TAG = 'profile_badges'

export type ProfileBadgeEntry = {
  definitionCoordinate: string
  awardEventId: string
}

export type ResolvedProfileBadge = {
  definitionCoordinate: string
  awardEventId: string
  name: string
  description?: string
  imageUrl?: string
}

/** Parse consecutive `a` / `e` pairs from a NIP-58 profile badges list event. */
export function parseProfileBadgeEntries(event: Event | undefined): ProfileBadgeEntry[] {
  if (!event) return []
  const out: ProfileBadgeEntry[] = []
  const tags = event.tags
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i]
    if (t[0] !== 'a' || !t[1]?.trim()) continue
    const next = tags[i + 1]
    if (next?.[0] === 'e' && next[1]?.trim()) {
      out.push({ definitionCoordinate: t[1].trim(), awardEventId: next[1].trim() })
      i++
    }
  }
  return out
}

export function isNip58ProfileBadgesListEvent(event: Event): boolean {
  if (event.kind === ExtendedKind.PROFILE_BADGES_LIST) return true
  if (event.kind !== ExtendedKind.PROFILE_BADGES) return false
  const d = event.tags.find(tagNameEquals('d'))?.[1]?.trim()
  return d === LEGACY_PROFILE_BADGES_D_TAG
}

export function parseAddressableCoordinate(
  coordinate: string
): { kind: number; pubkey: string; d: string } | null {
  const trimmed = coordinate.trim()
  const idx1 = trimmed.indexOf(':')
  if (idx1 < 0) return null
  const idx2 = trimmed.indexOf(':', idx1 + 1)
  if (idx2 < 0) return null
  const kind = parseInt(trimmed.slice(0, idx1), 10)
  if (!Number.isFinite(kind)) return null
  return {
    kind,
    pubkey: trimmed.slice(idx1 + 1, idx2),
    d: trimmed.slice(idx2 + 1)
  }
}

export function resolveBadgeDisplayFromDefinition(
  entry: ProfileBadgeEntry,
  defEvent: Event | undefined
): ResolvedProfileBadge {
  const parsed = parseAddressableCoordinate(entry.definitionCoordinate)
  const fallbackName = parsed?.d || entry.definitionCoordinate
  const name =
    defEvent?.tags.find(tagNameEquals('name'))?.[1]?.trim() ||
    defEvent?.tags.find(tagNameEquals('d'))?.[1]?.trim() ||
    fallbackName
  const description = defEvent?.tags.find(tagNameEquals('description'))?.[1]?.trim()
  const media = extractBadgeDefinitionMedia(defEvent)
  return {
    definitionCoordinate: entry.definitionCoordinate,
    awardEventId: entry.awardEventId,
    name,
    description: description || undefined,
    imageUrl: media.image ?? media.thumb
  }
}

export function profileBadgeEntryKey(entry: ProfileBadgeEntry): string {
  return `${entry.definitionCoordinate}\0${entry.awardEventId.toLowerCase()}`
}

/** Union of badge list entries; preserves `base` order, then appends extras from `extra`. */
export function mergeProfileBadgeEntries(
  base: ProfileBadgeEntry[],
  extra: ProfileBadgeEntry[]
): ProfileBadgeEntry[] {
  const seen = new Set(base.map(profileBadgeEntryKey))
  const out = [...base]
  for (const row of extra) {
    const key = profileBadgeEntryKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Append one claim to an existing list. Never removes entries.
 * Returns `null` if the award id or definition is already claimed.
 */
export function appendUnclaimedProfileBadge(
  existing: ProfileBadgeEntry[],
  claim: ProfileBadgeEntry
): ProfileBadgeEntry[] | null {
  const awardId = claim.awardEventId.trim().toLowerCase()
  const def = claim.definitionCoordinate.trim()
  if (!awardId || !def) return null
  if (!/^[0-9a-f]{64}$/i.test(awardId)) return null
  for (const row of existing) {
    if (row.awardEventId.toLowerCase() === awardId) return null
    if (row.definitionCoordinate === def) return null
  }
  return [...existing, { definitionCoordinate: def, awardEventId: awardId }]
}

/** Parse a kind 8 badge award for a specific recipient pubkey. */
export function parseBadgeAwardForRecipient(
  event: Event,
  recipientPubkey: string
): ProfileBadgeEntry | null {
  if (event.kind !== kinds.BadgeAward) return null
  const recipient = normalizeHexPubkey(recipientPubkey)
  if (!isValidPubkey(recipient)) return null

  const a = event.tags.find(tagNameEquals('a'))?.[1]?.trim()
  if (!a) return null
  const parsed = parseAddressableCoordinate(a)
  if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return null

  const awarded = event.tags.some(
    (t) => t[0] === 'p' && t[1] && hexPubkeysEqual(t[1], recipient)
  )
  if (!awarded) return null

  return {
    definitionCoordinate: a,
    awardEventId: event.id.toLowerCase()
  }
}

/** Awards not yet on the profile list (by award event id or definition coordinate). */
export function filterUnclaimedBadgeAwards(
  awards: ProfileBadgeEntry[],
  claimed: ProfileBadgeEntry[]
): ProfileBadgeEntry[] {
  const claimedAwards = new Set(claimed.map((c) => c.awardEventId.toLowerCase()))
  const claimedDefs = new Set(claimed.map((c) => c.definitionCoordinate))
  const out: ProfileBadgeEntry[] = []
  const seen = new Set<string>()
  for (const award of awards) {
    const id = award.awardEventId.toLowerCase()
    if (claimedAwards.has(id)) continue
    if (claimedDefs.has(award.definitionCoordinate)) continue
    const key = profileBadgeEntryKey(award)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(award)
  }
  return out
}
