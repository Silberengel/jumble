import { ExtendedKind } from '@/constants'
import { extractBadgeDefinitionMedia } from '@/lib/badge-definition-media'
import { tagNameEquals } from '@/lib/tag'
import { Event } from 'nostr-tools'

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
