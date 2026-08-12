import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  appendUnclaimedProfileBadge,
  filterUnclaimedBadgeAwards,
  mergeProfileBadgeEntries,
  parseBadgeAwardForRecipient,
  parseProfileBadgeEntries,
  parseAddressableCoordinate
} from './nip58-profile-badges'
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

const bob = 'f7234bd4c1394dda46d09f35bd384dd30cc552ad5541990f98844fb06676e9ca'
const alice = '79dff8f82963424e0bb02708a22e44b4980893e3a4be0fa3cb60a43b946764e3'
const awardId = '4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65'

describe('parseBadgeAwardForRecipient', () => {
  it('parses kind 8 awards for the recipient', () => {
    const event = {
      id: awardId,
      kind: 8,
      tags: [
        ['a', `30009:${alice}:bravery`],
        ['p', bob]
      ]
    } as Event
    expect(parseBadgeAwardForRecipient(event, bob)).toEqual({
      definitionCoordinate: `30009:${alice}:bravery`,
      awardEventId: awardId
    })
  })

  it('returns null when recipient is not tagged', () => {
    const event = {
      id: awardId,
      kind: 8,
      tags: [
        ['a', `30009:${alice}:bravery`],
        ['p', alice]
      ]
    } as Event
    expect(parseBadgeAwardForRecipient(event, bob)).toBeNull()
  })
})

describe('filterUnclaimedBadgeAwards', () => {
  it('excludes awards already on the list by id or definition', () => {
    const awards = [
      { definitionCoordinate: '30009:a:bravery', awardEventId: 'aa'.repeat(32) },
      { definitionCoordinate: '30009:a:honor', awardEventId: 'bb'.repeat(32) },
      { definitionCoordinate: '30009:a:new', awardEventId: 'cc'.repeat(32) }
    ]
    const claimed = [
      { definitionCoordinate: '30009:a:bravery', awardEventId: 'aa'.repeat(32) },
      { definitionCoordinate: '30009:a:honor', awardEventId: 'dd'.repeat(32) }
    ]
    expect(filterUnclaimedBadgeAwards(awards, claimed)).toEqual([
      { definitionCoordinate: '30009:a:new', awardEventId: 'cc'.repeat(32) }
    ])
  })
})

describe('appendUnclaimedProfileBadge', () => {
  it('appends without removing existing entries', () => {
    const existing = [{ definitionCoordinate: '30009:a:old', awardEventId: '11'.repeat(32) }]
    const next = appendUnclaimedProfileBadge(existing, {
      definitionCoordinate: '30009:a:new',
      awardEventId: '22'.repeat(32)
    })
    expect(next).toEqual([
      { definitionCoordinate: '30009:a:old', awardEventId: '11'.repeat(32) },
      { definitionCoordinate: '30009:a:new', awardEventId: '22'.repeat(32) }
    ])
    expect(existing).toHaveLength(1)
  })

  it('returns null when already claimed', () => {
    const existing = [{ definitionCoordinate: '30009:a:old', awardEventId: '11'.repeat(32) }]
    expect(
      appendUnclaimedProfileBadge(existing, {
        definitionCoordinate: '30009:a:old',
        awardEventId: '22'.repeat(32)
      })
    ).toBeNull()
  })
})

describe('mergeProfileBadgeEntries', () => {
  it('unions without dropping base entries', () => {
    const base = [{ definitionCoordinate: '30009:a:a', awardEventId: '11'.repeat(32) }]
    const extra = [
      { definitionCoordinate: '30009:a:a', awardEventId: '11'.repeat(32) },
      { definitionCoordinate: '30009:a:b', awardEventId: '22'.repeat(32) }
    ]
    expect(mergeProfileBadgeEntries(base, extra)).toEqual([
      { definitionCoordinate: '30009:a:a', awardEventId: '11'.repeat(32) },
      { definitionCoordinate: '30009:a:b', awardEventId: '22'.repeat(32) }
    ])
  })
})
