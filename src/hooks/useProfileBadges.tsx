import { ExtendedKind } from '@/constants'
import { extractBadgeDefinitionMedia } from '@/lib/badge-definition-media'
import {
  fetchNip58BadgeAward,
  fetchNip58BadgeDefinition,
  mergeNip58BadgeRelayPool
} from '@/lib/fetch-badge-nip58'
import indexedDb from '@/services/indexed-db.service'
import { Event } from 'nostr-tools'
import { tagNameEquals } from '@/lib/tag'

export type TProfileBadge = {
  /** Badge definition coordinate (e.g. "30009:alice:bravery") */
  a: string
  /** Badge award event id */
  awardId: string
  /** Human-readable name from definition */
  name?: string
  /** High-res image URL */
  image?: string
  /** Thumbnail URL (prefer thumb over image for grid display) */
  thumb?: string
  /** From badge definition (NIP-58) */
  description?: string
  /** Kind 8 award `created_at` when loaded */
  awardCreatedAt?: number
}

/** Parse a-tag "30009:pubkey:d" into { kind, pubkey, d } */
function parseATag(aTag: string): { kind: number; pubkey: string; d: string } | null {
  const parts = aTag.split(':')
  if (parts.length < 3) return null
  const kind = parseInt(parts[0], 10)
  if (isNaN(kind)) return null
  const pk = parts[1]
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) return null
  const d = parts.slice(2).join(':')
  if (!d) return null
  return { kind, pubkey: pk.toLowerCase(), d }
}

function mergeProfileBadgesByAwardId(seed: TProfileBadge[], fresh: TProfileBadge[]): TProfileBadge[] {
  const m = new Map<string, TProfileBadge>()
  for (const b of seed) m.set(b.awardId, b)
  for (const b of fresh) m.set(b.awardId, b)
  return [...m.values()]
}

export async function enrichBadgesFromIndexedDb(badges: TProfileBadge[]): Promise<TProfileBadge[]> {
  return Promise.all(
    badges.map(async (b) => {
      if (b.thumb || b.image) return b
      const parsed = parseATag(b.a)
      if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return b
      try {
        const def = await indexedDb.getReplaceableEvent(parsed.pubkey, parsed.kind, parsed.d)
        if (!def) return b
        const name = def.tags.find(tagNameEquals('name'))?.[1]
        const description = def.tags.find(tagNameEquals('description'))?.[1]
        const media = extractBadgeDefinitionMedia(def)
        return {
          ...b,
          name: name ?? b.name ?? parsed.d,
          image: media.image,
          thumb: media.thumb ?? media.image,
          description: description ?? b.description
        }
      } catch {
        return b
      }
    })
  )
}

/**
 * Resolves NIP-58 badge definitions/awards for the newest kind-30008 `profile_badges` event.
 * Used by profile accordion bundle fetch.
 */
export async function resolveProfileBadgeList(
  profileBadgesEvent: Event | undefined,
  urls: string[],
  blockedRelays: string[],
  seedBadges: TProfileBadge[] | null | undefined
): Promise<TProfileBadge[]> {
  if (!profileBadgesEvent) {
    return seedBadges?.length ? [...seedBadges] : []
  }

  const tags = profileBadgesEvent.tags
  const pairs: { a: string; e: string; eRelayHint?: string }[] = []
  for (let i = 0; i < tags.length - 1; i++) {
    const ta = tags[i]
    const te = tags[i + 1]
    if (
      ta[0] === 'a' &&
      te[0] === 'e' &&
      ta[1] &&
      te[1] &&
      /^[a-f0-9]{64}$/i.test(te[1])
    ) {
      pairs.push({ a: ta[1], e: te[1], eRelayHint: te[2] })
    }
  }

  if (pairs.length === 0) {
    return seedBadges?.length ? [...seedBadges] : []
  }

  const result: TProfileBadge[] = await Promise.all(
    pairs.map(async ({ a, e, eRelayHint }) => {
      const parsed = parseATag(a)
      if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) {
        return { a, awardId: e }
      }

      const relayPool = mergeNip58BadgeRelayPool(urls, eRelayHint, blockedRelays)
      const [defEvent, awardEvent] = await Promise.all([
        fetchNip58BadgeDefinition(parsed.pubkey, parsed.d, relayPool),
        fetchNip58BadgeAward(e, relayPool)
      ])

      const awardATag = awardEvent?.tags.find(tagNameEquals('a'))?.[1]
      const awardMatchesDefinition = !awardEvent || awardATag === a
      const awardCreatedAt =
        awardMatchesDefinition && awardEvent ? awardEvent.created_at : undefined

      if (defEvent) {
        try {
          await indexedDb.putReplaceableEvent(defEvent)
        } catch {
          /* ignore */
        }
      }

      if (!defEvent) {
        return { a, awardId: e, awardCreatedAt }
      }

      const name = defEvent.tags.find(tagNameEquals('name'))?.[1]
      const description = defEvent.tags.find(tagNameEquals('description'))?.[1]
      const media = extractBadgeDefinitionMedia(defEvent)

      return {
        a,
        awardId: e,
        name: name ?? parsed.d,
        image: media.image,
        thumb: media.thumb ?? media.image,
        description,
        awardCreatedAt
      }
    })
  )

  return mergeProfileBadgesByAwardId(seedBadges ?? [], result)
}
