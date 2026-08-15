import { describe, expect, it } from 'vitest'
import { hardenAsciidocLinkMacros, preprocessMarkdownMediaLinks } from './preprocessMarkup'

describe('preprocessMarkdownMediaLinks', () => {
  it('leaves a bare URL on its own line unchanged for WebPreview rendering', () => {
    const url =
      'https://blog.imwald.eu/p/npub123sfqjpgf54p28yd7cjlgrpcn4pra5zhlnheyldc39td9r3zhgpshcwk9x/d/the-palantir-world-order'
    const content = `This article is also available on my blog:\n\n${url}`
    const out = preprocessMarkdownMediaLinks(content)
    expect(out).toContain(url)
    expect(out).not.toContain(`[${url}](${url})`)
  })

  it('still wraps inline prose URLs as markdown links', () => {
    const url = 'https://example.com/page'
    const content = `See ${url} for details.`
    const out = preprocessMarkdownMediaLinks(content)
    expect(out).toContain(`[${url}](${url})`)
  })

  it('leaves a bare blossom image URL on its own line unchanged', () => {
    const url =
      'https://npub1gm7tuvr9atc6u7q3gevjfeyfyvmrlul4y67k7u7hcxztz67ceexs078rf6.blossom.band/d84ac5c76f7a4036605fea59cdab8ac0064c343beef88ae218dca2f85bdae728.jpg'
    const content = `Added numbers:\n\n${url}\n\nnostr:naddr1test`
    const out = preprocessMarkdownMediaLinks(content)
    expect(out).toContain(url)
    expect(out).not.toContain(`![](${url})`)
  })
})

describe('hardenAsciidocLinkMacros', () => {
  it('wraps link targets in passthrough and strips quoted labels', () => {
    const raw =
      'link:https://web.archive.org/x.pdf["The Biology of the Aardvark" (_Orycteropus afer_)\\"]'
    expect(hardenAsciidocLinkMacros(raw)).toBe(
      'link:++https://web.archive.org/x.pdf++[The Biology of the Aardvark (_Orycteropus afer_)]'
    )
  })

  it('drops empty wiki reference bullets', () => {
    expect(hardenAsciidocLinkMacros('*\n*\n* link:https://a.test[A]\n')).toContain(
      'link:++https://a.test++[A]'
    )
    expect(hardenAsciidocLinkMacros('*\n*\n').trim()).toBe('')
  })
})

describe('preprocessAsciidocMediaLinks', () => {
  it('does not re-wrap URLs already inside hardened link macros', async () => {
    const { preprocessAsciidocMediaLinks } = await import('./preprocessMarkup')
    const raw = [
      '* link:https://www.youtube.com/watch?v=1Z5OoBqqYsk[A YouTube video introducing the Bronx Zoo\'s aardvarks]',
      '* link:https://web.archive.org/web/20080414134457/http://www.tierseiten.com/roehrenzaehner/aardvark.pdf["The Biology of the Aardvark" (_Orycteropus afer_)\\"] the thesis with images'
    ].join('\n')
    const out = preprocessAsciidocMediaLinks(raw)
    expect(out).toContain(
      'link:++https://www.youtube.com/watch?v=1Z5OoBqqYsk++[A YouTube video introducing the Bronx Zoo\'s aardvarks]'
    )
    expect(out).toContain(
      'link:++https://web.archive.org/web/20080414134457/http://www.tierseiten.com/roehrenzaehner/aardvark.pdf++[The Biology of the Aardvark (_Orycteropus afer_)]'
    )
    // Corruption signatures from index-mismatched re-wraps (not the word "video").
    expect(out).not.toMatch(/(?:^|[^\w])ideo introducing/)
    expect(out).not.toMatch(/^\*\s*\+\+\[/m)
    expect(out).not.toMatch(/pdfogy/)
    expect(out).not.toMatch(/link:link:/)
    expect(out).toContain("A YouTube video introducing")
  })
})
