import { describe, expect, it } from 'vitest'
import { buildRecipientZapPaymentData, mergeRecipientZapPaymentData } from './useRecipientAlternativePayments'
import type { TProfile } from '@/types'

describe('mergeRecipientZapPaymentData', () => {
  it('keeps lightning from feed profile when relay fetch is still empty', () => {
    const feedProfile = {
      pubkey: 'aa'.repeat(32),
      lightningAddress: 'user@example.com'
    } as TProfile
    const partial = buildRecipientZapPaymentData(null, feedProfile, null)
    const empty = buildRecipientZapPaymentData(null, null, null)
    const merged = mergeRecipientZapPaymentData(partial, empty)
    expect(merged.canReceiveTip).toBe(true)
    expect(
      merged.alternativeGroups.length + (partial.canReceiveTip ? 1 : 0)
    ).toBeGreaterThan(0)
  })
})
