import { describe, expect, it } from 'vitest'
import { isLightningPaytoType, isZappableLightningPaytoType } from '@/lib/payto-registry'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { kinds, type Event } from 'nostr-tools'
import {
  buildOrderedZapLightningAddresses,
  getAlternativePaymentMethods,
  prepareZapDialogAlternativePayments,
  mergePaymentMethods,
  normalizeLightningAuthority,
  recipientHasAnyPaymentOptions
} from './merge-payment-methods'

describe('normalizeLightningAuthority', () => {
  it('maps dot variant to user@domain', () => {
    expect(normalizeLightningAuthority('User.Name@Example.COM')).toBe('user.name@example.com')
    expect(normalizeLightningAuthority('user.name@example.com')).toBe('user.name@example.com')
  })
})

describe('mergePaymentMethods lightning dedup', () => {
  it('keeps payto URI in sync when authority is canonicalized on merge', () => {
    const methods = mergePaymentMethods(
      {
        methods: [
          {
            type: 'lightning',
            authority: 'user.domain',
            payto: 'payto://lightning/user.domain',
            displayType: 'Lightning Network'
          },
          {
            type: 'lightning',
            authority: 'user@domain',
            payto: 'payto://lightning/user@domain',
            displayType: 'Lightning Network'
          }
        ]
      },
      null
    )

    expect(methods).toHaveLength(1)
    expect(methods[0].authority).toBe('user@domain')
    expect(methods[0].payto).toBe('payto://lightning/user%40domain')
  })
})

describe('isLightningPaytoType', () => {
  it('includes BIP-353 and excludes BIP-352', () => {
    expect(isLightningPaytoType('bip353')).toBe(true)
    expect(isLightningPaytoType('bip352')).toBe(false)
    expect(isLightningPaytoType('bitcoin')).toBe(false)
  })
})

describe('isZappableLightningPaytoType', () => {
  it('is LUD-16 lightning only', () => {
    expect(isZappableLightningPaytoType('lightning')).toBe(true)
    expect(isZappableLightningPaytoType('bip353')).toBe(false)
  })
})

describe('getAlternativePaymentMethods', () => {
  it('includes BIP-353 in zap dialog other payments', () => {
    const merged = mergePaymentMethods(
      {
        methods: [
          {
            type: 'lightning',
            authority: 'zap@example.com',
            payto: 'payto://lightning/zap@example.com',
            displayType: 'Lightning Network'
          },
          {
            type: 'bip353',
            authority: 'dns@example.com',
            payto: 'payto://bip353/dns@example.com',
            displayType: 'DNS Payment Instructions (BIP-353)'
          }
        ]
      },
      null
    )
    const alts = getAlternativePaymentMethods(merged)
    expect(alts.some((m) => m.type === 'bip353')).toBe(true)
    expect(alts.some((m) => m.type === 'lightning')).toBe(false)
  })
})

describe('buildOrderedZapLightningAddresses', () => {
  it('excludes BIP-353 from zap selector (payment options only)', () => {
    const addrs = buildOrderedZapLightningAddresses({
      profileEvent: null,
      paymentInfo: {
        methods: [
          {
            type: 'bip353',
            authority: 'user@example.com',
            payto: 'payto://bip353/user@example.com',
            displayType: 'DNS Payment Instructions (BIP-353)'
          },
          {
            type: 'lightning',
            authority: 'zap@example.com',
            payto: 'payto://lightning/zap@example.com',
            displayType: 'Lightning Network'
          }
        ]
      }
    })
    expect(addrs).toEqual(['zap@example.com'])
  })

  it('includes lud16 from kind 0 JSON when not in tags', () => {
    const profileEvent = {
      kind: kinds.Metadata,
      pubkey: 'aa'.repeat(32),
      created_at: 1,
      tags: [] as string[][],
      content: JSON.stringify({ lud16: 'user@example.com' }),
      id: 'bb'.repeat(64),
      sig: 'cc'.repeat(128)
    } as Event

    const addrs = buildOrderedZapLightningAddresses({
      profileEvent,
      paymentInfo: null
    })
    expect(addrs).toEqual(['user@example.com'])
    expect(recipientHasAnyPaymentOptions(null, getProfileFromEvent(profileEvent), profileEvent)).toBe(
      true
    )
  })
})

describe('prepareZapDialogAlternativePayments', () => {
  const groups = [
    {
      displayType: 'Tether (USDT)',
      methods: [{ type: 'usdt', authority: '0xusdt', displayType: 'Tether (USDT)' }]
    },
    {
      displayType: 'Bitcoin',
      methods: [{ type: 'bitcoin', authority: 'bc1qtest', displayType: 'Bitcoin' }]
    },
    {
      displayType: 'Liquid Bitcoin (LBTC)',
      methods: [{ type: 'lbtc', authority: 'lq1…', displayType: 'Liquid Bitcoin (LBTC)' }]
    },
    {
      displayType: 'Monero',
      methods: [{ type: 'monero', authority: '4…', displayType: 'Monero' }]
    },
    {
      displayType: 'USD Coin',
      methods: [{ type: 'usdc', authority: '0xusdc', displayType: 'USD Coin' }]
    }
  ]

  it('hides Bitcoin-category methods below 10k sats', () => {
    const { groups: out, showBitcoinOnChainHint } = prepareZapDialogAlternativePayments(groups, 9999)
    expect(showBitcoinOnChainHint).toBe(false)
    expect(out.some((g) => g.methods.some((m) => m.type === 'bitcoin'))).toBe(false)
    expect(out[0].displayType).toBe('Liquid Bitcoin (LBTC)')
    expect(out[1].displayType).toBe('Monero')
  })

  it('puts Bitcoin first with hint at 10k sats and above', () => {
    const { groups: out, showBitcoinOnChainHint } = prepareZapDialogAlternativePayments(groups, 10_000)
    expect(showBitcoinOnChainHint).toBe(true)
    expect(out[0].displayType).toBe('Bitcoin')
    expect(out[0].highlighted).toBe(true)
    expect(out[1].displayType).toBe('Liquid Bitcoin (LBTC)')
    expect(out[2].displayType).toBe('Monero')
    expect(out[3].displayType).toBe('Tether (USDT)')
    expect(out[4].displayType).toBe('USD Coin')
  })
})
