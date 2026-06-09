import { describe, expect, it } from 'vitest'
import {
  convertAsciiDocSource,
  plainAsciiDocSourceToHtml,
  resolveAsciiDocImageSrc,
  resolveRelativeImagesInAsciidocHtml
} from '@/lib/asciidoc-parse'

describe('convertAsciiDocSource', () => {
  it('converts valid AsciiDoc and reports no issues', async () => {
    const { html, issues, failed } = await convertAsciiDocSource('Hello *world*.')
    expect(failed).toBe(false)
    expect(html).toContain('Hello')
    expect(issues).toHaveLength(0)
  })

  it('returns partial HTML and issues for recoverable problems', async () => {
    const { html, issues, failed } = await convertAsciiDocSource(
      'include::missing-file.adoc[]\n\nStill here.'
    )
    expect(failed).toBe(false)
    expect(html).toContain('Still here')
    expect(issues.some((i) => /ERROR|missing-file/i.test(i))).toBe(true)
  })

  it('handles the redacted-science section image line', async () => {
    const content = `Jim Craddock

v1.0, January 2026

:imagesdir: media

image::image1.png[A close up of a sign AI-generated content may be incorrect.,width=613,height=129,align=center]`

    const { html, failed } = await convertAsciiDocSource(content)
    expect(failed).toBe(false)
    expect(html).toContain('Jim Craddock')
    expect(html).toContain('imageblock')
  })
})

describe('resolveAsciiDocImageSrc', () => {
  it('matches a remote URL by filename', () => {
    const url = 'https://i.nostr.build/media/image1.png'
    expect(resolveAsciiDocImageSrc('image1.png', 'media', [url])).toBe(url)
    expect(resolveAsciiDocImageSrc('media/image1.png', 'media', [url])).toBe(url)
  })
})

describe('plainAsciiDocSourceToHtml', () => {
  it('escapes and preserves paragraph breaks', () => {
    const html = plainAsciiDocSourceToHtml('Line one\n\nLine <two>')
    expect(html).toContain('Line one')
    expect(html).toContain('Line &lt;two&gt;')
    expect(html.match(/<p /g)?.length).toBe(2)
  })

  it('preserves single line breaks within a paragraph', () => {
    const html = plainAsciiDocSourceToHtml('Line one\nLine two')
    expect(html).toContain('<br>')
  })

  it('hides attribute blocks and renders image macros with tag URLs', () => {
    const content = `Jim Craddock

v1.0, January 2026

:sectnums:
:toc: left
:imagesdir: media

image::image1.png[Section illustration]`

    const html = plainAsciiDocSourceToHtml(content, {
      imageUrls: ['https://i.nostr.build/media/image1.png']
    })
    expect(html).toContain('Jim Craddock')
    expect(html).not.toContain(':sectnums:')
    expect(html).not.toContain('image::image1.png')
    expect(html).toContain('https://i.nostr.build/media/image1.png')
    expect(html).toContain('Section illustration')
  })
})

describe('resolveRelativeImagesInAsciidocHtml', () => {
  it('replaces broken data-uri img tags with imeta URLs', async () => {
    const content = `:imagesdir: media

image::image1.png[Alt text]`
    const { html } = await convertAsciiDocSource(content)
    const patched = resolveRelativeImagesInAsciidocHtml(html, content, [
      'https://i.nostr.build/media/image1.png'
    ])
    expect(patched).toContain('https://i.nostr.build/media/image1.png')
    expect(patched).not.toContain('data:image/png;base64,')
  })
})
