import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  collectMediaUrlsInContent,
  getOrphanedImetaMedia,
  hasImageUrlInContent,
  isNip71MediaKind,
  mediaBlobIdentityKey,
  shouldHideOrphanedImetaInAccordion
} from '@/lib/imeta-content-match'
import type { Event } from 'nostr-tools'

function fakeEvent(overrides: Partial<Event> & Pick<Event, 'kind' | 'content' | 'tags'>): Event {
  return {
    id: '0'.repeat(64),
    pubkey: '1'.repeat(64),
    created_at: 1,
    sig: 'sig',
    ...overrides
  } as Event
}

describe('imeta-content-match', () => {
  it('isNip71MediaKind matches kinds 20–22', () => {
    expect(isNip71MediaKind(ExtendedKind.PICTURE)).toBe(true)
    expect(isNip71MediaKind(ExtendedKind.VIDEO)).toBe(true)
    expect(isNip71MediaKind(ExtendedKind.SHORT_VIDEO)).toBe(true)
    expect(isNip71MediaKind(1)).toBe(false)
  })

  it('collectMediaUrlsInContent finds blossom video URLs', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const url = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}.mp4`
    const urls = collectMediaUrlsInContent(`See ${url}`)
    expect(urls.has(url)).toBe(true)
  })

  it('getOrphanedImetaMedia returns imeta when URL differs from content', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}.mp4`
    const nostrBuild = 'https://v.nostr.build/0lLUd9zqfNdIz7py.mp4'
    const event = fakeEvent({
      kind: ExtendedKind.SHORT_VIDEO,
      content: blossom,
      tags: [
        [
          'imeta',
          `url ${nostrBuild}`,
          'm video/mp4',
          `x ${hash}`,
          `ox ${hash}`
        ]
      ]
    })
    const orphaned = getOrphanedImetaMedia(event)
    expect(orphaned).toHaveLength(1)
    expect(orphaned[0].url).toBe(nostrBuild)
  })

  it('getOrphanedImetaMedia is empty when imeta URL matches content', () => {
    const url = 'https://example.com/photo.jpg'
    const event = fakeEvent({
      kind: 1,
      content: url,
      tags: [['imeta', `url ${url}`, 'm image/jpeg']]
    })
    expect(getOrphanedImetaMedia(event)).toHaveLength(0)
  })

  it('mediaBlobIdentityKey matches blossom path and imeta x tag', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}.mp4`
    expect(mediaBlobIdentityKey(blossom)).toBe(`sha256:${hash}`)
    expect(mediaBlobIdentityKey('https://v.nostr.build/x.mp4', hash)).toBe(`sha256:${hash}`)
  })

  it('hasImageUrlInContent ignores video URLs', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const video = `https://example.com/${hash}.mp4`
    const image = 'https://example.com/photo.jpg'
    expect(hasImageUrlInContent(video)).toBe(false)
    expect(hasImageUrlInContent(`${video} ${image}`)).toBe(true)
  })

  it('hasImageUrlInContent ignores extensionless blossom blob URLs', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}`
    expect(hasImageUrlInContent(blossom)).toBe(false)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 22 with video-only content renders inline', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const video = `https://example.com/${hash}.mp4`
    expect(shouldHideOrphanedImetaInAccordion(ExtendedKind.SHORT_VIDEO, video)).toBe(false)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 22 with image in content uses accordion', () => {
    expect(
      shouldHideOrphanedImetaInAccordion(
        ExtendedKind.SHORT_VIDEO,
        'https://example.com/cover.jpg'
      )
    ).toBe(true)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 1 without image uses accordion', () => {
    expect(shouldHideOrphanedImetaInAccordion(1, 'hello world')).toBe(true)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 1 with image in content renders inline', () => {
    expect(
      shouldHideOrphanedImetaInAccordion(1, 'https://example.com/photo.jpg')
    ).toBe(false)
  })
})
