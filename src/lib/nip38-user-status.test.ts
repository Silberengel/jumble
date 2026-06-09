import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  buildUserStatusTags,
  isUserStatusExpired,
  parseUserStatusEvent,
  userStatusLinkHref
} from './nip38-user-status'

function statusEvent(overrides: Partial<Event> & { content: string; d: string }): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    sig: 'c'.repeat(128),
    created_at: 100,
    kind: ExtendedKind.USER_STATUS,
    tags: overrides.tags ?? [['d', overrides.d]],
    ...overrides
  }
}

describe('nip38-user-status', () => {
  it('parses active general status', () => {
    const ev = statusEvent({
      d: 'general',
      content: 'Working',
      tags: [
        ['d', 'general'],
        ['r', 'https://nostr.world']
      ]
    })
    const parsed = parseUserStatusEvent(ev)
    expect(parsed?.type).toBe('general')
    expect(parsed?.content).toBe('Working')
    expect(userStatusLinkHref(parsed!)).toBe('https://nostr.world')
  })

  it('returns null for empty content', () => {
    const ev = statusEvent({ d: 'general', content: '   ' })
    expect(parseUserStatusEvent(ev)).toBeNull()
  })

  it('returns null when expired', () => {
    const ev = statusEvent({
      d: 'music',
      content: 'Song',
      tags: [
        ['d', 'music'],
        ['expiration', '50']
      ]
    })
    expect(isUserStatusExpired(ev, 100)).toBe(true)
    expect(parseUserStatusEvent(ev)).toBeNull()
  })

  it('buildUserStatusTags includes optional link and expiration', () => {
    expect(
      buildUserStatusTags({
        type: 'music',
        content: 'Track',
        linkUrl: 'spotify:search:test',
        expiration: 999
      })
    ).toEqual([
      ['d', 'music'],
      ['r', 'spotify:search:test'],
      ['expiration', '999']
    ])
  })
})
