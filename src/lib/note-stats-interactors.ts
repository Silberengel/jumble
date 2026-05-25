import type { TNoteStats } from '@/services/note-stats.service'
import { TEmoji } from '@/types'

export const MAX_NOTE_STATS_INTERACTORS_SHOWN = 32

export function emojiStatsKey(emoji: TEmoji | string): string {
  return typeof emoji === 'string' ? emoji : emoji.shortcode
}

/** Latest boost per pubkey, newest first. */
export function dedupeBoostersByPubkey(
  reposts: NonNullable<TNoteStats['reposts']>
): { pubkey: string; created_at: number }[] {
  const byPk = new Map<string, number>()
  for (const r of reposts) {
    const pk = r.pubkey.toLowerCase()
    const prev = byPk.get(pk)
    if (prev == null || r.created_at > prev) byPk.set(pk, r.created_at)
  }
  return [...byPk.entries()]
    .map(([pubkey, created_at]) => ({ pubkey, created_at }))
    .sort((a, b) => b.created_at - a.created_at)
}

export function groupReactionsByEmoji(
  likes: NonNullable<TNoteStats['likes']>
): { emoji: TEmoji | string; pubkeys: string[] }[] {
  const groups = new Map<string, { emoji: TEmoji | string; byPk: Map<string, number> }>()

  for (const like of likes) {
    const key = emojiStatsKey(like.emoji)
    let group = groups.get(key)
    if (!group) {
      group = { emoji: like.emoji, byPk: new Map() }
      groups.set(key, group)
    }
    const pk = like.pubkey.toLowerCase()
    const prev = group.byPk.get(pk)
    if (prev == null || like.created_at > prev) group.byPk.set(pk, like.created_at)
  }

  return [...groups.values()]
    .map((g) => ({
      emoji: g.emoji,
      pubkeys: [...g.byPk.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([pk]) => pk)
    }))
    .sort((a, b) => b.pubkeys.length - a.pubkeys.length)
}

/** Sum sats per pubkey, highest total first. */
export function aggregateZapsByPubkey(
  zaps: NonNullable<TNoteStats['zaps']>
): { pubkey: string; amount: number; created_at: number }[] {
  const byPk = new Map<string, { amount: number; created_at: number }>()
  for (const z of zaps) {
    const pk = z.pubkey.toLowerCase()
    const cur = byPk.get(pk)
    if (!cur) {
      byPk.set(pk, { amount: z.amount, created_at: z.created_at })
    } else {
      byPk.set(pk, {
        amount: cur.amount + z.amount,
        created_at: Math.max(cur.created_at, z.created_at)
      })
    }
  }
  return [...byPk.entries()]
    .map(([pubkey, v]) => ({ pubkey, ...v }))
    .sort((a, b) => b.amount - a.amount || b.created_at - a.created_at)
}
