import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  formatNip84SourceAnchorHint,
  parseTextQuoteSelectorParts,
  resolveNip84HighlightDisplay,
  textQuoteSelectorMisalignsWithContent
} from './nip84-highlight-display'

describe('parseTextQuoteSelectorParts', () => {
  it('parses Hypothesis-style empty slot', () => {
    expect(
      parseTextQuoteSelectorParts([
        'textquoteselector',
        '-',
        'natives And Parental Sovereignty',
        'On centralized platforms, parent'
      ])
    ).toEqual({
      prefix: 'natives And Parental Sovereignty',
      suffix: 'On centralized platforms, parent'
    })
  })
})

describe('resolveNip84HighlightDisplay', () => {
  it('uses classic NIP-84 prefix + exact + suffix', () => {
    const event: Pick<Event, 'content' | 'tags'> = {
      content: 'exact quote',
      tags: [['textquoteselector', 'Before ', ' after']]
    }
    const out = resolveNip84HighlightDisplay(event)
    expect(out.mode).toBe('quote')
    expect(out.fullText).toBe('Beforeexact quoteafter')
    expect(out.markedSpan).toBe('exact quote')
  })

  it('treats http r-tag + DOM selectors + misaligned tqs as web annotation', () => {
    const event: Pick<Event, 'content' | 'tags'> = {
      content:
        'Supporters of open source protocols argue that instead of handing power to state regulators or Silicon Valley, protocols like Nostr strip away corporate data tracking and predatory algorithms entirely.',
      tags: [
        ['r', 'https://dcrvpwlah116cf.archive.ph/'],
        ['textquoteselector', '-', 'natives And Parental Sovereignty', 'On centralized platforms, parent'],
        ['textpositionselector', '21099', '21617'],
        ['rangeselector', '/center[1]/div[5]', '/center[1]/div[5]', '0', '518']
      ]
    }
    const out = resolveNip84HighlightDisplay(event)
    expect(out.mode).toBe('web-annotation')
    expect(out.fullText).toBe(event.content)
    expect(out.markedSpan).toBe(event.content)
    expect(out.sourceAnchorHint).toContain('natives And Parental Sovereignty')
    expect(out.sourceAnchorHint).toContain('On centralized platforms, parent')
    expect(out.fullText).not.toContain('natives And Parental Sovereignty')
  })

  it('keeps context + position offsets on quoted passage', () => {
    const event: Pick<Event, 'content' | 'tags'> = {
      content: 'warmth of collectivism',
      tags: [
        [
          'context',
          'The warmth of collectivism, delivered through the infrastructure of control. This is the monetization of serfdom.'
        ],
        ['textpositionselector', '4', '26']
      ]
    }
    const out = resolveNip84HighlightDisplay(event)
    expect(out.mode).toBe('quote')
    expect(out.fullText).toContain('warmth of collectivism')
    expect(out.markedSpan).toBe('warmth of collectivism')
  })
})

describe('textQuoteSelectorMisalignsWithContent', () => {
  it('detects unrelated prefix and suffix', () => {
    expect(
      textQuoteSelectorMisalignsWithContent(
        'Totally different body text about Nostr.',
        'natives And Parental Sovereignty',
        'On centralized platforms, parent'
      )
    ).toBe(true)
  })

  it('accepts when suffix appears in content', () => {
    expect(textQuoteSelectorMisalignsWithContent('On centralized platforms, parents worry.', '', 'platforms')).toBe(
      false
    )
  })
})

describe('formatNip84SourceAnchorHint', () => {
  it('joins prefix and suffix with ellipsis', () => {
    expect(formatNip84SourceAnchorHint('Alpha', 'Beta')).toBe('Alpha … Beta')
  })
})
