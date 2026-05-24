import { describe, expect, it } from 'vitest'
import { isLightningPaytoType, isZappableLightningPaytoType } from '@/lib/payto-registry'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { kinds, type Event } from 'nostr-tools'
import {
  groupPaymentMethodsByDisplayType,
  groupPaymentMethodsForDisplay,
  sortPaymentMethodGroupsForSender,
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

describe('isZappableLightningPaytoType', () => {
  it('is LUD-16 lightning only', () => {
    expect(isZappableLightningPaytoType('lightning')).toBe(true)
    expect(isZappableLightningPaytoType('bip353')).toBe(false)
  })
})

describe('mergePaymentMethods kind 0 about coin lines', () => {
  it('imports XMR from about text', () => {
    const addr =
      '84mAJEgdihyRHkz8fGeuqgbQ19SuGeFWbhokJG2uMNMwTkDyoyQ3H7BijQNwSriSp9hHfaRGZYpCuKvHJwTer8av845U9py'
    const profileEvent = {
      kind: kinds.Metadata,
      pubkey: 'aa'.repeat(32),
      created_at: 1,
      tags: [] as string[][],
      content: JSON.stringify({
        about: `https://example.com\n\nXMR: ${addr}`
      }),
      id: 'bb'.repeat(64),
      sig: 'cc'.repeat(128)
    } as Event

    const methods = mergePaymentMethods(null, null, profileEvent)
    expect(methods.some((m) => m.type === 'monero' && m.authority === addr)).toBe(true)
  })
})

describe('mergePaymentMethods ordering', () => {
  it('lists profile then payment lightning addresses within Lightning Network', () => {
    const profileEvent = {
      kind: kinds.Metadata,
      pubkey: 'aa'.repeat(32),
      created_at: 1,
      tags: [
        ['lud16', 'profile-first@example.com'],
        ['lud16', 'profile-second@example.com']
      ] as string[][],
      content: '{}',
      id: 'bb'.repeat(64),
      sig: 'cc'.repeat(128)
    } as Event

    const methods = mergePaymentMethods(
      {
        methods: [
          {
            type: 'lightning',
            authority: 'profile-second@example.com',
            payto: 'payto://lightning/profile-second@example.com',
            displayType: 'Lightning Network'
          },
          {
            type: 'lightning',
            authority: 'payment-only@example.com',
            payto: 'payto://lightning/payment-only@example.com',
            displayType: 'Lightning Network'
          }
        ]
      },
      getProfileFromEvent(profileEvent),
      profileEvent
    )

    const lightning = groupPaymentMethodsByDisplayType(methods).find(
      (g) => g.displayType === 'Lightning Network'
    )?.methods

    expect(lightning?.map((m) => m.authority)).toEqual([
      'profile-first@example.com',
      'profile-second@example.com',
      'payment-only@example.com'
    ])
  })

  it('keeps distinct profile and payment targets across categories', () => {
    const profileEvent = {
      kind: kinds.Metadata,
      pubkey: 'aa'.repeat(32),
      created_at: 1,
      tags: [['payto', 'monero', '4profilemonero']] as string[][],
      content: '{}',
      id: 'bb'.repeat(64),
      sig: 'cc'.repeat(128)
    } as Event

    const methods = mergePaymentMethods(
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
      null,
      profileEvent
    )

    expect(methods).toHaveLength(3)
    expect(methods.some((m) => m.type === 'monero')).toBe(true)
    expect(methods.some((m) => m.type === 'lightning')).toBe(true)
    expect(methods.some((m) => m.type === 'bip353')).toBe(true)
  })
})

describe('mergePaymentMethods kind 0 cryptocurrency_addresses', () => {
  it('imports Garnet monero from profile JSON', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const profileEvent = {
      kind: kinds.Metadata,
      pubkey: 'aa'.repeat(32),
      created_at: 1,
      tags: [] as string[][],
      content: JSON.stringify({ cryptocurrency_addresses: { monero: addr } }),
      id: 'bb'.repeat(64),
      sig: 'cc'.repeat(128)
    } as Event

    const methods = mergePaymentMethods(null, null, profileEvent)
    expect(methods.some((m) => m.type === 'monero' && m.authority === addr)).toBe(true)
    expect(methods.find((m) => m.type === 'monero')?.payto).toBe(`payto://monero/${addr}`)
  })
})

describe('sortPaymentMethodGroupsForSender', () => {
  const groups = [
    {
      displayType: 'Geyser Fund',
      methods: [{ type: 'geyser', authority: 'proj', displayType: 'Geyser Fund' }]
    },
    {
      displayType: 'Monero',
      methods: [{ type: 'monero', authority: '4xmr', displayType: 'Monero' }]
    },
    {
      displayType: 'Bitcoin',
      methods: [{ type: 'bitcoin', authority: 'bc1q', displayType: 'Bitcoin' }]
    },
    {
      displayType: 'Ko-fi',
      methods: [{ type: 'ko-fi', authority: 'user', displayType: 'Ko-fi' }]
    }
  ]

  it('puts shared families first in lightning → monero → bitcoin → geyser order', () => {
    const sorted = sortPaymentMethodGroupsForSender(groups, new Set(['monero', 'bitcoin']))
    expect(sorted.map((g) => g.displayType)).toEqual([
      'Monero',
      'Bitcoin',
      'Geyser Fund',
      'Ko-fi'
    ])
  })

  it('orders geyser before other alphabetic types when both are shared', () => {
    const sorted = sortPaymentMethodGroupsForSender(groups, new Set(['geyser', 'ko-fi']))
    expect(sorted.map((g) => g.displayType)).toEqual([
      'Geyser Fund',
      'Ko-fi',
      'Monero',
      'Bitcoin'
    ])
  })
})

describe('groupPaymentMethodsForDisplay', () => {
  it('applies sender-aware ordering to merged methods', () => {
    const methods = mergePaymentMethods(
      {
        methods: [
          {
            type: 'geyser',
            authority: 'a',
            payto: 'payto://geyser/a',
            displayType: 'Geyser Fund'
          },
          {
            type: 'monero',
            authority: '4xmr',
            payto: 'payto://monero/4xmr',
            displayType: 'Monero'
          }
        ]
      },
      null,
      null
    )
    const groups = groupPaymentMethodsForDisplay(methods, new Set(['geyser']))
    expect(groups.map((g) => g.displayType)).toEqual(['Geyser Fund', 'Monero'])
  })
})
