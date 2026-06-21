import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  mergeHydratedCacheRelayListEvents,
  mergeHydratedHttpRelayListEvents
} from '@/lib/event-metadata'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function listEvent(kind: number, createdAt: number, tags: string[][]): Event {
  return {
    id: `${createdAt}`.padStart(64, '0'),
    kind,
    pubkey: PK,
    created_at: createdAt,
    content: '',
    tags,
    sig: 'c'.repeat(128)
  }
}

describe('mergeHydratedCacheRelayListEvents', () => {
  it('prefers stored cache relays when network returns a newer empty event', () => {
    const stored = listEvent(ExtendedKind.CACHE_RELAYS, 100, [['r', 'ws://127.0.0.1:4869']])
    const fetched = listEvent(ExtendedKind.CACHE_RELAYS, 200, [])
    expect(mergeHydratedCacheRelayListEvents([fetched], stored)).toBe(stored)
  })
})

describe('mergeHydratedHttpRelayListEvents', () => {
  it('prefers stored HTTP relays when network returns a newer empty event', () => {
    const stored = listEvent(ExtendedKind.HTTP_RELAY_LIST, 100, [['r', 'https://relay.example.com']])
    const fetched = listEvent(ExtendedKind.HTTP_RELAY_LIST, 200, [])
    expect(mergeHydratedHttpRelayListEvents([fetched], stored)).toBe(stored)
  })

  it('prefers newer fetched HTTP relays when both have entries', () => {
    const stored = listEvent(ExtendedKind.HTTP_RELAY_LIST, 100, [['r', 'https://old.example.com']])
    const fetched = listEvent(ExtendedKind.HTTP_RELAY_LIST, 200, [['r', 'https://new.example.com']])
    expect(mergeHydratedHttpRelayListEvents([fetched], stored)).toBe(fetched)
  })
})
