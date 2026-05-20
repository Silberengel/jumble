import { describe, expect, it } from 'vitest'
import { isLightningPaytoType } from '@/lib/payto-registry'
import {
  prepareZapDialogAlternativePayments,
  mergePaymentMethods,
  normalizeLightningAuthority
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
