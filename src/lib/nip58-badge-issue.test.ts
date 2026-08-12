import { describe, expect, it } from 'vitest'
import {
  badgeDefinitionCoordinate,
  buildBadgeDefinitionTags,
  normalizeBadgeDTag,
  parseBadgeRecipientPubkeys
} from './nip58-badge-issue'

describe('normalizeBadgeDTag', () => {
  it('slugifies spaces and punctuation', () => {
    expect(normalizeBadgeDTag('Medal of Bravery')).toBe('medal-of-bravery')
    expect(normalizeBadgeDTag('  GitCitadel_Supporter  ')).toBe('gitcitadel-supporter')
  })
})

describe('parseBadgeRecipientPubkeys', () => {
  const alice = '79dff8f82963424e0bb02708a22e44b4980893e3a4be0fa3cb60a43b946764e3'
  const bob = 'f7234bd4c1394dda46d09f35bd384dd30cc552ad5541990f98844fb06676e9ca'

  it('accepts hex pubkeys and dedupes', () => {
    const { pubkeys, invalidTokens } = parseBadgeRecipientPubkeys(`${alice}\n${alice},${bob}`)
    expect(invalidTokens).toEqual([])
    expect(pubkeys).toEqual([alice, bob])
  })

  it('reports invalid tokens', () => {
    const { pubkeys, invalidTokens } = parseBadgeRecipientPubkeys(`${alice} not-a-key`)
    expect(pubkeys).toEqual([alice])
    expect(invalidTokens).toEqual(['not-a-key'])
  })
})

describe('buildBadgeDefinitionTags', () => {
  it('requires d and includes optional fields', () => {
    const tags = buildBadgeDefinitionTags({
      d: 'Bravery!',
      name: 'Medal of Bravery',
      description: 'For courage',
      imageUrl: 'https://example.com/badge.png'
    })
    expect(tags).toEqual([
      ['d', 'bravery'],
      ['name', 'Medal of Bravery'],
      ['description', 'For courage'],
      ['image', 'https://example.com/badge.png'],
      ['thumb', 'https://example.com/badge.png']
    ])
  })
})

describe('badgeDefinitionCoordinate', () => {
  it('builds kind:pubkey:d', () => {
    expect(badgeDefinitionCoordinate('AABB', 'Bravery')).toBe('30009:aabb:bravery')
  })
})
