import { describe, expect, it } from 'vitest'
import { getDomainIconFallbackGlyph } from '@/lib/nip05-affiliation'

describe('getDomainIconFallbackGlyph', () => {
  it('uses tree emoji for theforest.nostr1.com NIP-05 domains', () => {
    expect(getDomainIconFallbackGlyph('theforest.nostr1.com')).toBe('🌲')
    expect(getDomainIconFallbackGlyph('TheForest.Nostr1.com.')).toBe('🌲')
  })

  it('does not override other affiliation domains', () => {
    expect(getDomainIconFallbackGlyph('nostr.land')).toBeUndefined()
    expect(getDomainIconFallbackGlyph('sovbit.host')).toBeUndefined()
  })
})
