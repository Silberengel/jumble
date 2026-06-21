import { describe, expect, it } from 'vitest'
import {
  composerImetaTagsEqual,
  extractMediaUrlsFromComposerContent,
  reconcileComposerImetaWithContent
} from './composer-imeta-content-sync'
import { buildImetaTagFromMediaUrl } from './composer-media-url-imeta'

describe('extractMediaUrlsFromComposerContent', () => {
  it('collects bare and markdown image URLs once', () => {
    const urls = extractMediaUrlsFromComposerContent(
      'see ![x](https://a.test/p.png) and https://a.test/p.png'
    )
    expect(urls).toEqual(['https://a.test/p.png'])
  })

  it('ignores non-media links', () => {
    expect(extractMediaUrlsFromComposerContent('read https://example.com/blog')).toEqual([])
  })
})

describe('reconcileComposerImetaWithContent', () => {
  const resolve = (url: string) => buildImetaTagFromMediaUrl(url)

  it('adds imeta for new content URLs', () => {
    const { tags, addedUrls } = reconcileComposerImetaWithContent(
      'https://x.test/a.jpg',
      [],
      resolve
    )
    expect(tags).toHaveLength(1)
    expect(addedUrls).toEqual(['https://x.test/a.jpg'])
  })

  it('removes orphan imeta when URL leaves content', () => {
    const old = [buildImetaTagFromMediaUrl('https://x.test/gone.webp')]
    const { tags, removedUrlKeys } = reconcileComposerImetaWithContent('hello', old, resolve)
    expect(tags).toEqual([])
    expect(removedUrlKeys).toContain('https://x.test/gone.webp')
  })

  it('preserves existing tag rows for URLs still in content', () => {
    const rich: string[] = ['imeta', 'url https://x.test/k.mp3', 'm audio/mpeg', 'dim 1x1']
    const { tags, addedUrls } = reconcileComposerImetaWithContent(
      'https://x.test/k.mp3',
      [rich],
      resolve
    )
    expect(tags).toEqual([rich])
    expect(addedUrls).toEqual([])
  })
})

describe('composerImetaTagsEqual', () => {
  it('compares by url keys regardless of row order', () => {
    const a = [buildImetaTagFromMediaUrl('https://a.test/1.jpg')]
    const b = [buildImetaTagFromMediaUrl('https://a.test/1.jpg')]
    expect(composerImetaTagsEqual(a, b)).toBe(true)
  })
})
