import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import { isPaymentAttestationForTarget } from './usePaymentAttestationStatus'
import type { Event } from 'nostr-tools'

const recipient = 'a'.repeat(64)
const targetId = 'b'.repeat(64)

function attestationEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'c'.repeat(64),
    kind: ExtendedKind.PAYMENT_ATTESTATION,
    pubkey: recipient,
    created_at: 1,
    tags: [['e', targetId], ['k', '9735']],
    content: '',
    sig: 'sig',
    ...overrides
  }
}

describe('isPaymentAttestationForTarget', () => {
  it('accepts a matching kind 9741 attestation', () => {
    expect(isPaymentAttestationForTarget(attestationEvent(), targetId, recipient)).toBe(true)
  })

  it('rejects zap receipts and other kinds', () => {
    expect(
      isPaymentAttestationForTarget(
        attestationEvent({ kind: ExtendedKind.ZAP_RECEIPT, tags: [['e', targetId]] }),
        targetId,
        recipient
      )
    ).toBe(false)
  })

  it('rejects attestations for a different payment target', () => {
    expect(
      isPaymentAttestationForTarget(
        attestationEvent({ tags: [['e', 'd'.repeat(64)], ['k', '9735']] }),
        targetId,
        recipient
      )
    ).toBe(false)
  })

  it('rejects attestations from a different author', () => {
    expect(
      isPaymentAttestationForTarget(
        attestationEvent({ pubkey: 'e'.repeat(64) }),
        targetId,
        recipient
      )
    ).toBe(false)
  })
})
