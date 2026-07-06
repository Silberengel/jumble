import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  REACTION_CLIP_MAX_EMOTIONS,
  buildReactionClipDraft,
  clipEmotionsFromTags,
  normalizeClipEmotions,
  sha256FromContentAddressedUrl
} from './reaction-clip'

const HASH = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2'

describe('reaction-clip', () => {
  it('buildReactionClipDraft emits imeta, mirrored x tag, NIP-32 emotion labels, and alt', () => {
    const draft = buildReactionClipDraft({
      url: `https://blossom.example/${HASH}.webp`,
      sha256: HASH,
      mimeType: 'image/webp',
      dim: '480x270',
      size: 12345,
      description: 'person covering their face in disbelief',
      emotions: ['disbelief', 'awkward']
    })
    expect(draft.kind).toBe(ExtendedKind.REACTION_CLIP)
    expect(draft.content).toBe('person covering their face in disbelief')

    const imeta = draft.tags.find((t) => t[0] === 'imeta')!
    expect(imeta).toContain(`x ${HASH}`)
    expect(imeta).toContain('m image/webp')
    expect(imeta).toContain('dim 480x270')

    expect(draft.tags).toContainEqual(['x', HASH])
    expect(draft.tags).toContainEqual(['L', 'emotion'])
    expect(draft.tags).toContainEqual(['l', 'disbelief', 'emotion'])
    expect(draft.tags).toContainEqual(['l', 'awkward', 'emotion'])
    expect(draft.tags.some((t) => t[0] === 'alt' && t[1]?.startsWith('Reaction clip'))).toBe(true)
    // Description tokens become searchable t tags.
    expect(draft.tags).toContainEqual(['t', 'disbelief'])
  })

  it('buildReactionClipDraft rejects missing hash or emotions', () => {
    expect(() =>
      buildReactionClipDraft({ url: 'https://x.example/a.gif', sha256: 'nope', emotions: ['joy'] })
    ).toThrow()
    expect(() =>
      buildReactionClipDraft({ url: 'https://x.example/a.gif', sha256: HASH, emotions: [] })
    ).toThrow()
  })

  it('normalizeClipEmotions lowercases, dedupes, and caps at the spec maximum', () => {
    const many = ['Joy', 'joy', 'ANGER', 'fear', 'love', 'awkward', 'surprise', 'sadness']
    const out = normalizeClipEmotions(many)
    expect(out[0]).toBe('joy')
    expect(out).toContain('anger')
    expect(out.length).toBeLessThanOrEqual(REACTION_CLIP_MAX_EMOTIONS)
    expect(new Set(out).size).toBe(out.length)
  })

  it('clipEmotionsFromTags reads only l tags in the emotion namespace', () => {
    const tags = [
      ['L', 'emotion'],
      ['l', 'disbelief', 'emotion'],
      ['l', 'de', 'ISO-639-1'],
      ['t', 'facepalm']
    ]
    expect(clipEmotionsFromTags(tags)).toEqual(['disbelief'])
  })

  it('sha256FromContentAddressedUrl extracts blossom-style hashes and rejects others', () => {
    expect(sha256FromContentAddressedUrl(`https://blossom.example/${HASH}.webp`)).toBe(HASH)
    expect(sha256FromContentAddressedUrl(`https://blossom.example/${HASH.toUpperCase()}.gif`)).toBe(
      HASH
    )
    expect(sha256FromContentAddressedUrl('https://cdn.example/funny-cat.gif')).toBeNull()
    expect(sha256FromContentAddressedUrl('not a url')).toBeNull()
  })
})
