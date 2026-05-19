import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import { parseProfileBadgeEntries, parseAddressableCoordinate } from './nip58-profile-badges'
import type { Event } from 'nostr-tools'

describe('parseProfileBadgeEntries', () => {
  it('pairs consecutive a and e tags', () => {
    const event = {
      kind: ExtendedKind.PROFILE_BADGES_LIST,
      tags: [
        ['a', '30009:alice:bravery'],
        ['e', 'award1'],
        ['a', '30009:alice:honor'],
        ['e', 'award2'],
        ['a', '30009:alice:orphan']
      ]
    } as Event
    expect(parseProfileBadgeEntries(event)).toEqual([
      { definitionCoordinate: '30009:alice:bravery', awardEventId: 'award1' },
      { definitionCoordinate: '30009:alice:honor', awardEventId: 'award2' }
    ])
  })
})

describe('parseAddressableCoordinate', () => {
  it('parses kind pubkey and d', () => {
    expect(parseAddressableCoordinate('30009:alice:bravery')).toEqual({
      kind: 30009,
      pubkey: 'alice',
      d: 'bravery'
    })
  })
})
