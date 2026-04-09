import { describe, expect, it } from 'vitest'
import { canUseNostrBuildThumb, toNostrBuildThumbUrl } from './nostr-build'

describe('nostr-build thumb URLs', () => {
  it('allows /thumb/ rewrite only for i.nostr.build images', () => {
    expect(canUseNostrBuildThumb('https://i.nostr.build/foo.webp')).toBe(true)
    expect(toNostrBuildThumbUrl('https://i.nostr.build/foo.webp')).toBe(
      'https://i.nostr.build/thumb/foo.webp'
    )
  })

  it('does not rewrite cdn.nostr.build (no /thumb/ service)', () => {
    expect(canUseNostrBuildThumb('https://cdn.nostr.build/i/abc123.webp')).toBe(false)
    expect(toNostrBuildThumbUrl('https://cdn.nostr.build/i/abc123.webp')).toBe(
      'https://cdn.nostr.build/i/abc123.webp'
    )
  })

  it('does not rewrite video URLs on i.nostr.build', () => {
    const u = 'https://i.nostr.build/bar.webm'
    expect(canUseNostrBuildThumb(u)).toBe(false)
    expect(toNostrBuildThumbUrl(u)).toBe(u)
  })
})
