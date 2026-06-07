import {
  IndexRelayTransportError,
  clearDevIndexRelayUnavailableThisSession,
  isDevIndexRelayUnavailableThisSession,
  isIndexRelayTransportFailure,
  rawToIndexRelayEvent
} from '@/lib/index-relay-http'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { describe, expect, it, beforeEach } from 'vitest'

describe('isIndexRelayTransportFailure', () => {
  it('treats IndexRelayTransportError as transport failure', () => {
    expect(isIndexRelayTransportFailure(new IndexRelayTransportError())).toBe(true)
    expect(isIndexRelayTransportFailure(new IndexRelayTransportError(new Error('HTTP 500')))).toBe(true)
  })

  it('treats network TypeError as transport failure', () => {
    expect(isIndexRelayTransportFailure(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('dev index relay session skip', () => {
  beforeEach(() => {
    clearDevIndexRelayUnavailableThisSession()
  })

  it('starts available after clear', () => {
    expect(isDevIndexRelayUnavailableThisSession()).toBe(false)
  })
})

describe('rawToIndexRelayEvent', () => {
  it('accepts kind 30040 with empty or null content per NKBIP-01', () => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const verified = finalizeEvent(
      {
        kind: 30040,
        created_at: 1_700_000_000,
        tags: [
          ['d', 'book'],
          ['title', 'Test Book'],
          ['a', `30041:${pubkey}:chapter-1`]
        ],
        content: ''
      },
      sk
    )
    const mercuryRow = { ...verified, content: null } as unknown as Record<string, unknown>
    const parsed = rawToIndexRelayEvent(mercuryRow)
    expect(parsed?.content).toBe('')
    expect(parsed?.kind).toBe(30040)
  })
})
