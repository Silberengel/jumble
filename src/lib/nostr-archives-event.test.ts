import { describe, expect, it } from 'vitest'
import {
  archivesJsonToVerifiedEvent,
  isPersistableNostrEventShape,
  stripArchivesEngagementFields
} from '@/lib/nostr-archives-event'
import type { Event } from 'nostr-tools'

describe('stripArchivesEngagementFields', () => {
  it('removes engagement fields but keeps nested event wrapper', () => {
    const inner = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: 1,
      content: 'hi',
      created_at: 1,
      tags: [],
      sig: 'c'.repeat(128)
    }
    const raw = {
      event: inner,
      reactions: 5,
      replies: 2,
      reposts: 1,
      zap_sats: 100
    }
    const stripped = stripArchivesEngagementFields(raw)
    expect(stripped.event).toEqual(inner)
    expect(stripped).not.toHaveProperty('reactions')
    expect(stripped).not.toHaveProperty('replies')
    expect(stripped).not.toHaveProperty('reposts')
    expect(stripped).not.toHaveProperty('zap_sats')
  })
})

describe('isPersistableNostrEventShape', () => {
  const base = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1,
    content: 'hi',
    created_at: 1700000000,
    tags: [] as string[][],
    sig: 'c'.repeat(128)
  } as Event

  it('rejects NaN kind', () => {
    expect(isPersistableNostrEventShape({ ...base, kind: NaN })).toBe(false)
  })

  it('rejects NaN created_at', () => {
    expect(isPersistableNostrEventShape({ ...base, created_at: NaN })).toBe(false)
  })
})

describe('archivesJsonToVerifiedEvent', () => {
  it('returns null when kind is missing and coerces to NaN', () => {
    expect(
      archivesJsonToVerifiedEvent({
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        content: 'hi',
        created_at: 1700000000,
        tags: [],
        sig: 'c'.repeat(128)
      })
    ).toBeNull()
  })
})
