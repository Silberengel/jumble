import { ExtendedKind } from '@/constants'
import { LEGACY_PROFILE_BADGES_D_TAG } from '@/lib/nip58-profile-badges'
import { shouldOfferProfileBadgesMigration } from '@/lib/nip58-profile-badges-list'
import type { Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

function listEvent(
  kind: number,
  created_at: number,
  pairs: Array<[string, string]>,
  d?: string
): Event {
  const tags: string[][] = []
  if (d !== undefined) tags.push(['d', d])
  for (const [a, e] of pairs) {
    tags.push(['a', a])
    tags.push(['e', e])
  }
  return {
    id: 'id',
    pubkey: 'aa'.repeat(32),
    created_at,
    kind,
    tags,
    content: '',
    sig: 'sig'
  }
}

describe('shouldOfferProfileBadgesMigration', () => {
  const legacy = listEvent(
    ExtendedKind.PROFILE_BADGES,
    100,
    [['30009:aa:bravery', 'bb'.repeat(32)]],
    LEGACY_PROFILE_BADGES_D_TAG
  )

  it('offers when only legacy list has entries', () => {
    expect(shouldOfferProfileBadgesMigration(null, legacy)).toBe(true)
  })

  it('offers when kind 10008 is empty but legacy has entries', () => {
    const empty = listEvent(ExtendedKind.PROFILE_BADGES_LIST, 200, [])
    expect(shouldOfferProfileBadgesMigration(empty, legacy)).toBe(true)
  })

  it('offers when legacy is newer than current', () => {
    const current = listEvent(ExtendedKind.PROFILE_BADGES_LIST, 50, [
      ['30009:aa:other', 'cc'.repeat(32)]
    ])
    expect(shouldOfferProfileBadgesMigration(current, legacy)).toBe(true)
  })

  it('does not offer when current is up to date', () => {
    const current = listEvent(ExtendedKind.PROFILE_BADGES_LIST, 200, [
      ['30009:aa:bravery', 'bb'.repeat(32)]
    ])
    expect(shouldOfferProfileBadgesMigration(current, legacy)).toBe(false)
  })

  it('does not offer without legacy entries', () => {
    const emptyLegacy = listEvent(
      ExtendedKind.PROFILE_BADGES,
      100,
      [],
      LEGACY_PROFILE_BADGES_D_TAG
    )
    expect(shouldOfferProfileBadgesMigration(null, emptyLegacy)).toBe(false)
  })
})
