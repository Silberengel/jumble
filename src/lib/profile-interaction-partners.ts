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

/** Same recency horizon as the interaction map UI (≈ half a year). */
export const INTERACTION_MAP_RECENCY_MAX_AGE_SEC = 180 * 86400

export type TRankedInteractionPartner = {
  stat: TInteractionPartnerStat
  /** 0–100: more mentions and more recent references rank higher (matches map “heat” weights). */
  score: number
}

/**
 * Sort by combined frequency + recency. Uses `nowSec` and `maxAgeSec` like the map card shading
 * (55% mention density vs max in list, 45% recency within the age window).
 */
export function rankInteractionPartnersByRecencyAndFrequency(
  partners: TInteractionPartnerStat[],
  nowSec: number,
  maxAgeSec: number = INTERACTION_MAP_RECENCY_MAX_AGE_SEC
): TRankedInteractionPartner[] {
  if (partners.length === 0) return []
  const age = Math.max(1, maxAgeSec)
  const maxM = Math.max(1, ...partners.map((p) => p.mentionCount))

  const scoreFor = (p: TInteractionPartnerStat): number => {
    const countNorm = Math.min(1, p.mentionCount / maxM)
    const recencyNorm =
      p.lastReferencedAt > 0
        ? 1 - Math.min(1, Math.max(0, nowSec - p.lastReferencedAt) / age)
        : 0
    return 100 * (0.55 * countNorm + 0.45 * recencyNorm)
  }

  return [...partners]
    .map((stat) => ({ stat, score: scoreFor(stat) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.stat.mentionCount - a.stat.mentionCount ||
        b.stat.lastReferencedAt - a.stat.lastReferencedAt ||
        a.stat.pubkey.localeCompare(b.stat.pubkey)
    )
}

/**
 * Rows for the interaction map grid: ranked by frequency/recency, with optional merge of the viewer’s
 * follows. When `includeAllFollows` is true, returns **every** merged row (no row cap): people from cached
 * tags first (by score), then everyone who appears only from your follow list (stable pubkey order).
 */
export function rankInteractionMapGridRows(
  partners: TInteractionPartnerStat[],
  opts: {
    includeAllFollows: boolean
    followings: string[]
    nowSec: number
    maxAgeSec?: number
    /** Max rows when `includeAllFollows` is false (interaction-only view). Ignored when including follows. */
    gridCap?: number
  }
): TRankedInteractionPartner[] {
  const {
    includeAllFollows,
    followings,
    nowSec,
    maxAgeSec = INTERACTION_MAP_RECENCY_MAX_AGE_SEC,
    gridCap = 72
  } = opts

  if (!includeAllFollows) {
    return rankInteractionPartnersByRecencyAndFrequency(partners, nowSec, maxAgeSec).slice(0, gridCap)
  }

  const merged = mergeInteractionPartnersWithFollowings(partners, followings)
  if (merged.length === 0) return []

  const tagged = merged.filter((p) => p.mentionCount > 0 || p.lastReferencedAt > 0)
  const followOnly = merged.filter((p) => p.mentionCount === 0 && p.lastReferencedAt === 0)

  const rankedTagged = rankInteractionPartnersByRecencyAndFrequency(tagged, nowSec, maxAgeSec)
  const extrasSorted = [...followOnly].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
  const extraRows: TRankedInteractionPartner[] = extrasSorted.map((stat) => ({ stat, score: 0 }))
  return [...rankedTagged, ...extraRows]
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

/** Adds follow pubkeys not already present so the viewer can manage follows from the interaction grid. */
export function mergeInteractionPartnersWithFollowings(
  partners: TInteractionPartnerStat[],
  followedPubkeys: string[]
): TInteractionPartnerStat[] {
  const map = new Map<string, TInteractionPartnerStat>()
  for (const p of partners) {
    const k = p.pubkey.trim().toLowerCase()
    if (!HEX64.test(k)) continue
    map.set(k, { pubkey: k, mentionCount: p.mentionCount, lastReferencedAt: p.lastReferencedAt })
  }
  for (const raw of followedPubkeys) {
    const k = raw.trim().toLowerCase()
    if (!HEX64.test(k)) continue
    if (!map.has(k)) {
      map.set(k, { pubkey: k, mentionCount: 0, lastReferencedAt: 0 })
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.mentionCount - a.mentionCount ||
      b.lastReferencedAt - a.lastReferencedAt ||
      a.pubkey.localeCompare(b.pubkey)
  )
}
