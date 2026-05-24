import { describe, expect, it } from 'vitest'

import type { PaymentMethodGroup } from '@/lib/merge-payment-methods'
import {
  getPaymentMethodGroupCategory,
  partitionPaymentGroupsByPreferredCategory
} from '@/lib/payto-category-display'

function group(type: string, displayType: string): PaymentMethodGroup {
  return {
    displayType,
    methods: [{ type, authority: 'addr', payto: `payto://${type}/addr`, displayType }]
  }
}

describe('payto-category-display', () => {
  it('reads category from first method type', () => {
    expect(getPaymentMethodGroupCategory(group('lightning', 'Lightning'))).toBe('bitcoin-layer')
    expect(getPaymentMethodGroupCategory(group('monero', 'Monero'))).toBe('monero')
    expect(getPaymentMethodGroupCategory(group('xmr', 'Monero'))).toBe('monero')
  })

  it('treats monero as part of crypto preference', () => {
    const groups = [group('monero', 'Monero'), group('ethereum', 'Ethereum'), group('bitcoin', 'Bitcoin')]
    const { preferredGroups, otherGroups } = partitionPaymentGroupsByPreferredCategory(groups, 'crypto')
    expect(preferredGroups.map((g) => g.displayType).sort()).toEqual(['Ethereum', 'Monero'])
    expect(otherGroups).toHaveLength(1)
  })

  it('partitions monero-only when monero preference is set', () => {
    const groups = [group('monero', 'Monero'), group('ethereum', 'Ethereum')]
    const { preferredGroups, otherGroups } = partitionPaymentGroupsByPreferredCategory(groups, 'monero')
    expect(preferredGroups).toHaveLength(1)
    expect(preferredGroups[0].displayType).toBe('Monero')
    expect(otherGroups).toHaveLength(1)
  })

  it('partitions groups by preferred category', () => {
    const groups = [
      group('lightning', 'Lightning'),
      group('monero', 'Monero'),
      group('bitcoin', 'Bitcoin')
    ]
    const { preferredGroups, otherGroups } = partitionPaymentGroupsByPreferredCategory(
      groups,
      'bitcoin-layer'
    )
    expect(preferredGroups).toHaveLength(1)
    expect(preferredGroups[0].displayType).toBe('Lightning')
    expect(otherGroups).toHaveLength(2)
  })

  it('returns all groups as preferred when preference is unset', () => {
    const groups = [group('lightning', 'Lightning'), group('monero', 'Monero')]
    const { preferredGroups, otherGroups } = partitionPaymentGroupsByPreferredCategory(groups, null)
    expect(preferredGroups).toEqual(groups)
    expect(otherGroups).toHaveLength(0)
  })

  it('shows all groups expanded when preferred category has no matches', () => {
    const groups = [group('monero', 'Monero'), group('bitcoin', 'Bitcoin')]
    const { preferredGroups, otherGroups } = partitionPaymentGroupsByPreferredCategory(
      groups,
      'fiat'
    )
    expect(preferredGroups).toEqual(groups)
    expect(otherGroups).toHaveLength(0)
  })
})
