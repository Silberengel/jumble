import { muteSetHas } from '@/lib/mute-set'
import type { Event } from 'nostr-tools'

const MAX_CARDS = 80

export type InteractionCard = {
  pubkey: string
  score: number
  authoredByProfile: number
  mentionsProfile: number
  latestCreatedAt: number
  eventIds: Set<string>
}

export function mergeInteractionEvents(
  targetPubkey: string,
  events: Event[],
  mutePubkeySet: ReadonlySet<string>
): InteractionCard[] {
  const target = targetPubkey.toLowerCase()
  const byPubkey = new Map<string, InteractionCard>()
  const add = (partnerRaw: string | undefined, event: Event, direction: 'out' | 'in') => {
    if (muteSetHas(mutePubkeySet, event.pubkey)) return
    const partner = partnerRaw?.trim().toLowerCase()
    if (!partner || partner === target || !/^[0-9a-f]{64}$/.test(partner)) return
    if (muteSetHas(mutePubkeySet, partner)) return
    let row = byPubkey.get(partner)
    if (!row) {
      row = {
        pubkey: partner,
        score: 0,
        authoredByProfile: 0,
        mentionsProfile: 0,
        latestCreatedAt: 0,
        eventIds: new Set()
      }
      byPubkey.set(partner, row)
    }
    if (row.eventIds.has(event.id)) return
    row.eventIds.add(event.id)
    row.score += 1
    row.latestCreatedAt = Math.max(row.latestCreatedAt, event.created_at)
    if (direction === 'out') row.authoredByProfile += 1
    else row.mentionsProfile += 1
  }

  for (const event of events) {
    const pTags = [
      ...new Set(
        event.tags
          .filter((tag) => tag[0] === 'p' && /^[0-9a-f]{64}$/i.test(tag[1] ?? ''))
          .map((tag) => tag[1]!.toLowerCase())
      )
    ]
    if (event.pubkey.toLowerCase() === target) {
      for (const partner of pTags) add(partner, event, 'out')
    } else if (pTags.includes(target)) {
      add(event.pubkey, event, 'in')
    }
  }

  return [...byPubkey.values()]
    .sort((a, b) => b.score - a.score || b.latestCreatedAt - a.latestCreatedAt || a.pubkey.localeCompare(b.pubkey))
    .slice(0, MAX_CARDS)
}
