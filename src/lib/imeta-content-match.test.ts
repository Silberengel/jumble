import { ExtendedKind } from '@/constants'
import {
  collectMediaUrlsInContent,
  getOrphanedImetaMedia,
  getSuppressedImetaMedia,
  hasImageUrlInContent,
  hasMediaUrlInContent,
  isNip71MediaKind,
  mediaBlobIdentityKey,
  redundantImetaUrlSet,
  shouldHideOrphanedImetaInAccordion
} from '@/lib/imeta-content-match'
import type { Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

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

  it('getOrphanedImetaMedia is empty when imeta mirrors content blob via x tag', () => {
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
    expect(getOrphanedImetaMedia(event)).toHaveLength(0)
    expect(redundantImetaUrlSet(event).has(nostrBuild)).toBe(true)
    expect(getSuppressedImetaMedia(event)).toHaveLength(1)
    expect(getSuppressedImetaMedia(event)[0]?.url).toBe(nostrBuild)
  })

  it('getSuppressedImetaMedia includes redundant mirror on kind 1 with image in content', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://example.com/${hash}.jpg`
    const mirror = 'https://v.nostr.build/mirror.jpg'
    const event = fakeEvent({
      kind: 1,
      content: blossom,
      tags: [['imeta', `url ${mirror}`, 'm image/jpeg', `x ${hash}`]]
    })
    expect(shouldHideOrphanedImetaInAccordion(1, blossom)).toBe(false)
    expect(getSuppressedImetaMedia(event)).toHaveLength(1)
    expect(getSuppressedImetaMedia(event)[0]?.url).toBe(mirror)
  })

  it('getOrphanedImetaMedia returns imeta when URL and blob differ from content', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}.mp4`
    const nostrBuild = 'https://v.nostr.build/0lLUd9zqfNdIz7py.mp4'
    const otherHash = 'b'.repeat(64)
    const event = fakeEvent({
      kind: ExtendedKind.SHORT_VIDEO,
      content: blossom,
      tags: [
        [
          'imeta',
          `url ${nostrBuild}`,
          'm video/mp4',
          `x ${otherHash}`,
          `ox ${otherHash}`
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
    expect(getSuppressedImetaMedia(event)).toHaveLength(0)
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

  it('hasMediaUrlInContent includes video URLs', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const video = `https://example.com/${hash}.mp4`
    expect(hasMediaUrlInContent(video)).toBe(true)
    expect(hasImageUrlInContent(video)).toBe(false)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 22 with video-only content uses accordion', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const video = `https://example.com/${hash}.mp4`
    expect(shouldHideOrphanedImetaInAccordion(ExtendedKind.SHORT_VIDEO, video)).toBe(true)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 22 with image in content uses accordion', () => {
    expect(
      shouldHideOrphanedImetaInAccordion(
        ExtendedKind.SHORT_VIDEO,
        'https://example.com/cover.jpg'
      )
    ).toBe(true)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 1 without media uses accordion', () => {
    expect(shouldHideOrphanedImetaInAccordion(1, 'hello world')).toBe(true)
  })

  it('shouldHideOrphanedImetaInAccordion: kind 1 with image in content renders inline', () => {
    expect(
      shouldHideOrphanedImetaInAccordion(1, 'https://example.com/photo.jpg')
    ).toBe(false)
  })

  it('getSuppressedImetaMedia is empty when imeta URL literally matches kind-1 content', () => {
    const url =
      'https://cdn.nostrcheck.me/6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93/d8bcf79ca7559dee73b99d5091afba7f600905c23056ae9e0ae803f39b64ac1c.png'
    const content = `🫠\n${url}`
    const event = fakeEvent({
      kind: 1,
      content,
      tags: [
        [
          'imeta',
          `url ${url}`,
          'm image/png',
          'x d8bcf79ca7559dee73b99d5091afba7f600905c23056ae9e0ae803f39b64ac1c',
          'ox d8bcf79ca7559dee73b99d5091afba7f600905c23056ae9e0ae803f39b64ac1c'
        ]
      ]
    })
    expect(hasMediaUrlInContent(content)).toBe(true)
    expect(shouldHideOrphanedImetaInAccordion(1, content)).toBe(false)
    expect(getOrphanedImetaMedia(event)).toHaveLength(0)
    expect(getSuppressedImetaMedia(event)).toHaveLength(0)
  })

  it('getSuppressedImetaMedia is empty when kind-20 imeta URLs match content exactly', () => {
    const url1 = 'https://i.nostr.build/fJUBsT5ztYNoEgF0.webp'
    const url2 = 'https://i.nostr.build/LdvIvWAy3ev4LHnZ.webp'
    const content = `Harvest time\n${url1}\n${url2}`
    const event = fakeEvent({
      kind: ExtendedKind.PICTURE,
      content,
      tags: [
        [
          'imeta',
          `url ${url1}`,
          'm image/webp',
          'x 47d36cd307fb34a642ea88fc1cb24ccf0e52ef6403149cc6b54bdfb415767fff'
        ],
        [
          'imeta',
          `url ${url2}`,
          'm image/webp',
          'x 1d772a2dc9348ae63c39cf7ccdb6c5407a16c97cf40a5bd1ab249f15fa47d5d0'
        ]
      ]
    })
    expect(shouldHideOrphanedImetaInAccordion(ExtendedKind.PICTURE, content)).toBe(true)
    expect(getOrphanedImetaMedia(event)).toHaveLength(0)
    expect(getSuppressedImetaMedia(event)).toHaveLength(0)
  })
})
