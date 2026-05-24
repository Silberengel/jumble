import { describe, expect, it } from 'vitest'
import { buildRecipientPaymentData, mergeRecipientPaymentData } from './useRecipientAlternativePayments'
import type { TProfile } from '@/types'

describe('mergeRecipientPaymentData', () => {
  it('keeps lightning from feed profile when relay fetch is still empty', () => {
    const feedProfile = {
      pubkey: 'aa'.repeat(32),
      lightningAddress: 'user@example.com'
    } as TProfile
    const partial = buildRecipientPaymentData(null, feedProfile, null)
    const empty = buildRecipientPaymentData(null, null, null)
    const merged = mergeRecipientPaymentData(partial, empty)
    expect(merged.canReceiveTip).toBe(true)
    expect(merged.profile?.lightningAddress).toBe('user@example.com')
  })
})
