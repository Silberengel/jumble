import type { Event } from 'nostr-tools'

const HEX64 = /^[0-9a-f]{64}$/i

/** Pubkeys this author tags with `p` or references via `a` (kind:pubkey:…), excluding self. */
export function extractPartnerPubkeysFromEvent(event: Event, authorPubkeyLower: string): string[] {
  const self = authorPubkeyLower.toLowerCase()
  const found = new Set<string>()
  for (const t of event.tags ?? []) {
    const name = t[0]
    if (name === 'p' || name === 'P') {
      const pk = (t[1] ?? '').trim().toLowerCase()
      if (HEX64.test(pk) && pk !== self) found.add(pk)
      continue
    }
    if (name === 'a' || name === 'A') {
      const coord = (t[1] ?? '').trim()
      const parts = coord.split(':')
      if (parts.length >= 2) {
        const pk = parts[1]!.toLowerCase()
        if (HEX64.test(pk) && pk !== self) found.add(pk)
      }
    }
  }
  return [...found]
}

export type TInteractionPartnerStat = {
  pubkey: string
  /** How often this pubkey appears in p / a references on the author's events */
  mentionCount: number
  /** Latest event created_at among those references */
  lastReferencedAt: number
}

export function buildInteractionPartnerStats(events: Event[], authorPubkey: string): TInteractionPartnerStat[] {
  const author = authorPubkey.trim().toLowerCase()
  if (!HEX64.test(author)) return []

  const byPk = new Map<string, { count: number; lastAt: number }>()

  for (const ev of events) {
    if (!ev?.pubkey || ev.pubkey.toLowerCase() !== author) continue
    const ts = typeof ev.created_at === 'number' ? ev.created_at : 0
    for (const pk of extractPartnerPubkeysFromEvent(ev, author)) {
      const cur = byPk.get(pk) ?? { count: 0, lastAt: 0 }
      cur.count += 1
      cur.lastAt = Math.max(cur.lastAt, ts)
      byPk.set(pk, cur)
    }
  }

  return [...byPk.entries()]
    .map(([pubkey, v]) => ({
      pubkey,
      mentionCount: v.count,
      lastReferencedAt: v.lastAt
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount || b.lastReferencedAt - a.lastReferencedAt)
}

export function mergeEventsById(events: Event[]): Event[] {
  const m = new Map<string, Event>()
  for (const e of events) {
    if (!e?.id) continue
    const prev = m.get(e.id)
    if (!prev || e.created_at > prev.created_at) m.set(e.id, e)
  }
  return [...m.values()]
}
