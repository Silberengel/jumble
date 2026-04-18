import { describe, expect, it, vi } from 'vitest'
import {
  getMarkupProtectRanges,
  rangeIntersectsMerged,
  translateAdvancedLabMarkup
} from '@/lib/advanced-lab-markup-protect'

vi.mock('@/lib/translate-client', () => ({
  translatePlainText: vi.fn(async (text: string) => `<${text}>`)
}))

describe('getMarkupProtectRanges', () => {
  it('kind-1 editor promo: most of body stays translatable (no runaway freeze before CodeMirror)', () => {
    const t =
      "I added an advanced editor to #imwald. I'm testing it, locally, and it seems like some sort of miracle. CodeMirror for Markdown and Asciidoc, grammar and spelling checks for all languages with my own instance of https://languagetool.org/, translations with LibreTranslate that can handle markup, citation event helper, Latex helper, custom emoji support, undo button, local autosave and recovery, npub/naddr/nevent mention, etc."
    const merged = getMarkupProtectRanges(t, 'markdown')
    const cm = t.indexOf('CodeMirror')
    expect(cm).toBeGreaterThan(0)
    expect(rangeIntersectsMerged(cm, 'CodeMirror'.length, merged)).toBe(false)
    const frozen = merged.reduce((acc, [a, b]) => acc + (b - a), 0)
    expect(frozen).toBeLessThan(t.length * 0.25)
  })

  it('freezes ATX heading marker and following whitespace', () => {
    const merged = getMarkupProtectRanges('# Hello', 'markdown')
    expect(merged.some(([a, b]) => a === 0 && b === 2)).toBe(true)
  })

  it('freezes inline math including delimiters', () => {
    const t = 'a $\\sqrt{x}$ b'
    const merged = getMarkupProtectRanges(t, 'markdown')
    const i0 = t.indexOf('$')
    const i1 = t.indexOf('$', i0 + 1)
    expect(i0).toBeGreaterThanOrEqual(0)
    expect(i1).toBeGreaterThan(i0)
    expect(rangeIntersectsMerged(i0, i1 - i0 + 1, merged)).toBe(true)
  })

  it('freezes display math', () => {
    const t = 'pre $$a+b$$ post'
    const merged = getMarkupProtectRanges(t, 'markdown')
    const start = t.indexOf('$$')
    expect(rangeIntersectsMerged(start, 2, merged)).toBe(true)
  })

  it('respects CRLF when matching line-leading markup', () => {
    const t = '# A\r\nplain'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(merged.some(([a, b]) => a === 0 && b === 2)).toBe(true)
  })

  it('freezes a fenced code block by line scanning', () => {
    const t = '```js\nx\n```\n# H'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(merged.some(([a, b]) => a === 0 && b >= t.indexOf('```', 3) + 3)).toBe(true)
    const hashLine = t.lastIndexOf('#')
    expect(rangeIntersectsMerged(hashLine, 2, merged)).toBe(true)
  })

  it('markdown: freezes each pipe in a GFM-style table row', () => {
    const t = '| Cell | Other |'
    const merged = getMarkupProtectRanges(t, 'markdown')
    const pipes = [...t.matchAll(/\|/g)].map((m) => m.index!)
    for (const idx of pipes) {
      expect(rangeIntersectsMerged(idx, 1, merged)).toBe(true)
    }
  })

  it('markdown: freezes alignment separator line as a whole', () => {
    const t = '| --- | :---: |'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(merged.some(([a, b]) => a === 0 && b === t.length)).toBe(true)
  })

  it('markdown: freezes link brackets and URL part, not label', () => {
    const t = '[Label](https://a.com)'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(rangeIntersectsMerged(0, 1, merged)).toBe(true)
    expect(rangeIntersectsMerged(t.indexOf(']'), 1, merged)).toBe(true)
    expect(rangeIntersectsMerged(t.indexOf('L'), 5, merged)).toBe(false)
  })

  it('markdown: link title in quotes is not frozen (only quotes and URL)', () => {
    const t = '[L](https://a.com "Link title")'
    const merged = getMarkupProtectRanges(t, 'markdown')
    const titleBodyStart = t.indexOf('Link title')
    expect(rangeIntersectsMerged(titleBodyStart, 'Link title'.length, merged)).toBe(false)
    expect(rangeIntersectsMerged(t.indexOf('"'), 1, merged)).toBe(true)
  })

  it('markdown: freezes footnote reference span', () => {
    const t = 'See[^1]here'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(rangeIntersectsMerged(3, 4, merged)).toBe(true)
  })

  it('markdown: freezes NIP emoji shortcode span', () => {
    const t = 'hi :chad_yes: bye'
    const merged = getMarkupProtectRanges(t, 'markdown')
    const i = t.indexOf(':chad_yes:')
    expect(rangeIntersectsMerged(i, ':chad_yes:'.length, merged)).toBe(true)
  })

  it('markdown: freezes inline code span', () => {
    const t = 'a `code` b'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(rangeIntersectsMerged(t.indexOf('`'), 6, merged)).toBe(true)
  })

  it('asciidoc: freezes source block including fences', () => {
    const t = '[source,js]\n----\nconst x = 1\n----\n'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && b === t.length)).toBe(true)
  })

  it('asciidoc: freezes stem macro span', () => {
    const t = 'x stem:[\\alpha] y'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    const s = t.indexOf('stem:')
    expect(rangeIntersectsMerged(s, 'stem:[\\alpha]'.length, merged)).toBe(true)
  })

  it('freezes wiki double-bracket spans (bookstr, citation, wikis)', () => {
    const t = '[[wikis|Nostr]] [[book::genesis]] [[citation::inline::x]]'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(merged.some(([a, b]) => t.slice(a, b) === '[[wikis|Nostr]]')).toBe(true)
    expect(merged.some(([a, b]) => t.slice(a, b) === '[[book::genesis]]')).toBe(true)
    expect(merged.some(([a, b]) => t.slice(a, b).startsWith('[[citation::'))).toBe(true)
  })

  it('freezes nostr: and bare npub1', () => {
    const npub = 'npub1' + 'q'.repeat(58)
    const t = `x nostr:${npub} y ${npub} z`
    const merged = getMarkupProtectRanges(t, 'markdown')
    const atNostr = t.indexOf('nostr:')
    expect(rangeIntersectsMerged(atNostr, `nostr:${npub}`.length, merged)).toBe(true)
    expect(rangeIntersectsMerged(t.lastIndexOf(npub), npub.length, merged)).toBe(true)
  })

  it('markdown: freezes a full raw https URL (blossom npub-shaped host; .gif not translatable)', () => {
    const url =
      'https://npub1uq6dv4yq94704gk5r22jsqg9gy2wpxkk5dft9q5gugc8tj53nq2qg5q22d.blossom.band/efc560395efdc7327db278ea4a7677905f69fecf1e6db754f41309d62f8ddb23.gif'
    const t = `See this\n${url}\nnext`
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(
      merged.some(([a, b]) => {
        const s = t.slice(a, b)
        return s.startsWith('https://') && s.endsWith('.gif') && s.includes('blossom.band')
      })
    ).toBe(true)
    expect(rangeIntersectsMerged(t.indexOf('.gif'), 4, merged)).toBe(true)
  })

  it('freezes BOOKSTR_MARKER passthrough and WIKILINK marker', () => {
    const book = 'BOOKSTR_MARKER:foo:BOOKSTR_END'
    const wiki = 'WIKILINK:my-page[My Page]'
    const merged = getMarkupProtectRanges(`${book} ${wiki}`, 'markdown')
    expect(merged.some(([a, b]) => a === 0 && b === book.length)).toBe(true)
    expect(merged.some(([a, b]) => b - a === wiki.length)).toBe(true)
  })

  it('freezes link: and menu: bracket macros in markdown', () => {
    const t = 'link:https://x.com[Go] menu:File[Quit]'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(merged.some(([a, b]) => t.slice(a, b) === 'link:https://x.com[Go]')).toBe(true)
    expect(merged.some(([a, b]) => t.slice(a, b) === 'menu:File[Quit]')).toBe(true)
  })

  it('asciidoc: freezes section title prefix', () => {
    const merged = getMarkupProtectRanges('= Title', 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && b === 2)).toBe(true)
  })

  it('asciidoc: freezes unordered and ordered list markers', () => {
    const star = getMarkupProtectRanges('* one', 'asciidoc')
    expect(star.some(([a, b]) => a === 0 && b === 2)).toBe(true)
    const dot = getMarkupProtectRanges('.. two', 'asciidoc')
    expect(dot.some(([a, b]) => a === 0 && b === 3)).toBe(true)
  })

  it('asciidoc: freezes labeled list marker', () => {
    const t = 'CPU:: The brain'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && t.slice(a, b) === 'CPU:: ')).toBe(true)
  })

  it('asciidoc: freezes attribute name and following spaces', () => {
    const t = ':toc: Table of contents'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && t.slice(a, b) === ':toc: ')).toBe(true)
  })

  it('asciidoc: freezes whole-line include macro', () => {
    const t = 'include::chapter.adoc[]'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && b === t.length)).toBe(true)
  })

  it('asciidoc: delimiter line is fully frozen', () => {
    const t = '----'
    const merged = getMarkupProtectRanges(t, 'asciidoc')
    expect(merged.some(([a, b]) => a === 0 && b === t.length)).toBe(true)
  })
})

describe('translateAdvancedLabMarkup', () => {
  it('translates heading text but not the # prefix', async () => {
    const out = await translateAdvancedLabMarkup('# Title', 'de', 'en', 'markdown')
    expect(out).toBe('# <Title>')
  })

  it('does not send math delimiters or body to translate', async () => {
    const t = 'x $\\sqrt{y}$ z'
    const out = await translateAdvancedLabMarkup(t, 'de', 'en', 'markdown')
    expect(out).toContain('$\\sqrt{y}$')
    expect(out).toBe('<x >$\\sqrt{y}$< z>')
  })

  it('asciidoc: translates heading text after equals marker', async () => {
    const out = await translateAdvancedLabMarkup('= Title', 'de', 'en', 'asciidoc')
    expect(out).toBe('= <Title>')
  })

  it('markdown: translates table cell text but not pipes', async () => {
    const out = await translateAdvancedLabMarkup('| Cell |', 'ru', 'en', 'markdown')
    expect(out).toBe('|< Cell >|')
  })

  it('markdown: leaves separator row unchanged', async () => {
    const t = '| --- | --- |\n| a | b |'
    const out = await translateAdvancedLabMarkup(t, 'ru', 'en', 'markdown')
    expect(out).toContain('| --- | --- |')
    expect(out).toMatch(/\|\s*< a >\s*\|/)
  })

  it('markdown: translates link label only', async () => {
    const out = await translateAdvancedLabMarkup('[Hi](https://x.com)', 'de', 'en', 'markdown')
    expect(out).toBe('[<Hi>](https://x.com)')
  })

  it('markdown: does not translate raw https URL (npub-like blossom host / .gif path)', async () => {
    const url =
      'https://npub1uq6dv4yq94704gk5r22jsqg9gy2wpxkk5dft9q5gugc8tj53nq2qg5q22d.blossom.band/x.gif'
    const out = await translateAdvancedLabMarkup(`Before\n${url}\nAfter`, 'de', 'en', 'markdown')
    expect(out).toContain(url)
    expect(out).toBe('<Before>\n' + url + '\n<After>')
  })

  it('markdown: freezes #hashtag tokens when mixed with prose', () => {
    const t = 'Cool #meme and #memestr stuff'
    const merged = getMarkupProtectRanges(t, 'markdown')
    expect(rangeIntersectsMerged(t.indexOf('#meme'), 5, merged)).toBe(true)
    expect(rangeIntersectsMerged(t.indexOf('#memestr'), 8, merged)).toBe(true)
  })

  it('markdown: leaves hashtags unchanged inside translated prose', async () => {
    const out = await translateAdvancedLabMarkup('Enjoy #meme today', 'de', 'en', 'markdown')
    expect(out).toContain('#meme')
    expect(out).toMatch(/#meme/)
  })

  it('markdown: translates optional link title in quotes', async () => {
    const out = await translateAdvancedLabMarkup(
      '[Hi](https://x.com "Link title")',
      'de',
      'en',
      'markdown'
    )
    expect(out).toBe('[<Hi>](https://x.com "<Link title>")')
  })

  it('markdown: does not translate :shortcode: spans', async () => {
    const out = await translateAdvancedLabMarkup('Hello :chad_yes: world', 'de', 'en', 'markdown')
    expect(out).toBe('<Hello >:chad_yes:< world>')
  })

  it('preserves newlines: translate API is never called with embedded line breaks', async () => {
    const { translatePlainText } = await import('@/lib/translate-client')
    const spy = vi.mocked(translatePlainText)
    spy.mockClear()
    spy.mockImplementation(async (s: string) => `<${s}>`)
    await translateAdvancedLabMarkup('Line1\nLine2', 'de', 'en', 'markdown')
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toMatch(/\r|\n/)
    }
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['Line1', 'Line2'])
  })

  it('optional preserveEmbeddedNewlinesInTranslatable sends one translatePlainText per translatable segment', async () => {
    const { translatePlainText } = await import('@/lib/translate-client')
    const spy = vi.mocked(translatePlainText)
    spy.mockClear()
    spy.mockImplementation(async (s: string) => `<<${s}>>`)
    await translateAdvancedLabMarkup('Line1\nLine2', 'de', 'en', 'markdown', {
      preserveEmbeddedNewlinesInTranslatable: true
    })
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['Line1\nLine2'])
  })

  it('preserves blank lines between translated lines', async () => {
    const { translatePlainText } = await import('@/lib/translate-client')
    vi.mocked(translatePlainText).mockImplementation(async (s: string) => (s === 'A' ? 'Aa' : 'Bb'))
    const out = await translateAdvancedLabMarkup('A\n\nB', 'de', 'en', 'markdown')
    expect(out).toBe('Aa\n\nBb')
  })

  it('markdown: every blockquote line body is passed to translate (regression: middle line not frozen)', async () => {
    const content =
      'Far-right and far-left logic be like:\n\n' +
      '> Stephen cheered when John was fired.\n' +
      '> We do not like Stephen.\n' +
      '> John should not have been fired.\n\n' +
      'This is a logical argument the Germans call _Beifall von der falschen Seite._ Where you judge.'
    const { translatePlainText } = await import('@/lib/translate-client')
    const spy = vi.mocked(translatePlainText)
    spy.mockClear()
    spy.mockImplementation(async (s: string) => `[${s}]`)
    await translateAdvancedLabMarkup(content, 'de', 'en', 'markdown')
    const payloads = spy.mock.calls.map((c) => String(c[0]))
    expect(payloads.some((p) => p.includes('We do not like Stephen'))).toBe(true)
    expect(payloads.some((p) => p.includes('Stephen cheered when John was fired'))).toBe(true)
    expect(payloads.some((p) => p.includes('John should not have been fired'))).toBe(true)
  })
})
