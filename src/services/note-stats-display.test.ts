import { describe, expect, it } from 'vitest'
import { displayTotalTipSats } from '@/services/note-stats.service'

describe('displayTotalTipSats', () => {
  const rates = { btcUsd: 100_000, xmrUsd: 200 }

  it('sums lightning, payment notifications, and monero tips as sats', () => {
    const total = displayTotalTipSats(
      {
        zaps: [{ pr: 'p1', pubkey: 'aa', amount: 1000, created_at: 1 }],
        paymentNotifications: [{ id: 'n1', pubkey: 'bb', amountSats: 500, created_at: 2 }],
        moneroTips: [{ id: 'm1', pubkey: 'cc', amountPiconero: 500_000_000_000_000, created_at: 3 }]
      },
      rates
    )
    expect(total).toBe(100_000_000 + 500 + 1000)
  })

  it('returns only lightning sats when monero rates are unavailable', () => {
    expect(
      displayTotalTipSats(
        {
          moneroTips: [{ id: 'm1', pubkey: 'cc', amountPiconero: 500_000_000_000_000, created_at: 3 }],
          zaps: [{ pr: 'p1', pubkey: 'aa', amount: 21, created_at: 1 }]
        },
        { btcUsd: null, xmrUsd: null }
      )
    ).toBe(21)
  })
})
