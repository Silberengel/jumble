import { describe, expect, it } from 'vitest'
import {
  extendHttpUrlPrefixWithBalancedParens,
  findHttpUrlsInText,
  formatBareHttpUrlForMarkdownAutolink
} from '@/lib/url'
import { preprocessMarkdownMediaLinks } from '@/components/Note/MarkdownArticle/preprocessMarkup'

describe('findHttpUrlsInText', () => {
  it('extends Wikipedia paths with balanced parentheses', () => {
    const content =
      'See https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings) for art.'
    const urls = findHttpUrlsInText(content)
    expect(urls).toHaveLength(1)
    expect(urls[0]?.url).toBe('https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings)')
  })
})

describe('formatBareHttpUrlForMarkdownAutolink', () => {
  it('uses angle brackets when URL contains parentheses', () => {
    const url = 'https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings)'
    expect(formatBareHttpUrlForMarkdownAutolink(url)).toBe(`<${url}>`)
  })
})

describe('preprocessMarkdownMediaLinks', () => {
  it('wraps paren URLs as GFM autolinks', () => {
    const input =
      'The right side is from https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings).'
    const out = preprocessMarkdownMediaLinks(input)
    expect(out).toContain('<https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings)>')
    expect(out).not.toContain('[https://en.wikipedia.org/wiki/The_Course_of_Empire_(paintings)]')
  })
})

describe('extendHttpUrlPrefixWithBalancedParens', () => {
  it('stops at whitespace inside unclosed parens', () => {
    const content = 'https://x.example/a_(broken path'
    const prefix = 'https://x.example/a_'
    expect(extendHttpUrlPrefixWithBalancedParens(content, 0, prefix)).toBe(prefix)
  })
})
