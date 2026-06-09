import { describe, expect, it } from 'vitest'
import {
  aggregateMoneroTipsByPubkey,
  aggregateSatoshiPaymentsByPubkey,
  aggregateZapsByPubkey,
  dedupeBoostersByPubkey,
  groupReactionsByEmoji
} from './note-stats-interactors'

describe('note-stats-interactors', () => {
  it('dedupes boosters by pubkey keeping latest', () => {
    const out = dedupeBoostersByPubkey([
      { id: 'a', pubkey: 'AA'.repeat(32), created_at: 1 },
      { id: 'b', pubkey: 'AA'.repeat(32), created_at: 5 },
      { id: 'c', pubkey: 'BB'.repeat(32), created_at: 3 }
    ])
    expect(out).toHaveLength(2)
    expect(out[0].pubkey).toBe('aa'.repeat(32))
    expect(out[0].created_at).toBe(5)
  })

  it('groups reactions by emoji', () => {
    const pk1 = '1'.repeat(64)
    const pk2 = '2'.repeat(64)
    const groups = groupReactionsByEmoji([
      { id: 'a', pubkey: pk1, created_at: 1, emoji: '❤️' },
      { id: 'b', pubkey: pk2, created_at: 2, emoji: '❤️' },
      { id: 'c', pubkey: pk1, created_at: 3, emoji: '🔥' }
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].emoji).toBe('❤️')
    expect(groups[0].pubkeys).toHaveLength(2)
  })

  it('aggregates zap amounts per pubkey', () => {
    const pk = 'A'.repeat(64)
    const out = aggregateZapsByPubkey([
      { pr: '1', pubkey: pk, amount: 100, created_at: 1 },
      { pr: '2', pubkey: pk, amount: 50, created_at: 2 }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(150)
  })

  it('merges zaps and payment notifications per pubkey', () => {
    const pk = 'A'.repeat(64)
    const pk2 = 'B'.repeat(64)
    const out = aggregateSatoshiPaymentsByPubkey(
      [{ pr: '1', pubkey: pk, amount: 100, created_at: 1 }],
      [
        { id: 'n1', pubkey: pk, amountSats: 50, created_at: 2 },
        { id: 'n2', pubkey: pk2, amountSats: 0, created_at: 3 }
      ]
    )
    expect(out).toHaveLength(2)
    expect(out[0].pubkey).toBe(pk.toLowerCase())
    expect(out[0].amount).toBe(150)
    expect(out[1].pubkey).toBe(pk2.toLowerCase())
    expect(out[1].amount).toBe(0)
  })

  it('aggregates monero tip piconeros per pubkey', () => {
    const pk = 'A'.repeat(64)
    const out = aggregateMoneroTipsByPubkey([
      { id: '1', pubkey: pk, amountPiconero: 500_000_000_000, created_at: 1 },
      { id: '2', pubkey: pk, amountPiconero: 100_000_000_000, created_at: 2 }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].amountPiconero).toBe(600_000_000_000)
  })
})
