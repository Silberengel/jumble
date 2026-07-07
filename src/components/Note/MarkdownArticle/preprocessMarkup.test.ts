import { describe, expect, it } from 'vitest'
import { preprocessMarkdownMediaLinks } from './preprocessMarkup'

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
