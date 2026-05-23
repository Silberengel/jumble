import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  rememberPaymentAttestationFromPublish,
  resolveAttestedPaymentIdSetSync
} from '@/lib/payment-attestation-cache'
import type { Event } from 'nostr-tools'

const RECIPIENT = 'a'.repeat(64)
const PAYMENT_ID = 'd'.repeat(64)

vi.mock('@/services/client.service', () => ({
  default: {
    peekSessionCachedEvent: vi.fn(),
    eventService: {
      getSessionEventsMatchingFilters: vi.fn(() => [])
    }
  }
}))

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: partial.id ?? 'e'.repeat(64),
    pubkey: partial.pubkey ?? RECIPIENT,
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind,
    tags: partial.tags,
    content: partial.content ?? '',
    sig: partial.sig ?? 'sig'
  }
}

describe('resolveAttestedPaymentIdSetSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns attested target ids from in-memory attestations without IndexedDB', () => {
    rememberPaymentAttestationFromPublish(
      fakeEvent({
        kind: ExtendedKind.PAYMENT_ATTESTATION,
        pubkey: RECIPIENT,
        tags: [
          ['e', PAYMENT_ID],
          ['k', '9740']
        ]
      })
    )
    const ids = resolveAttestedPaymentIdSetSync(RECIPIENT)
    expect(ids.has(PAYMENT_ID)).toBe(true)
  })
})
