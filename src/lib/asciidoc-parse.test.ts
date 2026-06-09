import { describe, expect, it } from 'vitest'
import {
  convertAsciiDocSource,
  plainAsciiDocSourceToHtml
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
})
