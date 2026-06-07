import { describe, expect, it } from 'vitest'
import { extractNip32LabelValues, formatNip32LabelSnippet } from '@/lib/nip32-label'
import type { Event } from 'nostr-tools'

describe('nip32-label', () => {
  it('extracts lowercase l tag values, not uppercase L namespace declarations', () => {
    const tags = [
      ['L', 'ugc'],
      ['l', 'booklist', 'ugc'],
      ['a', '30040:abc:book', 'wss://relay.example']
    ]
    expect(extractNip32LabelValues(tags)).toEqual(['booklist'])
  })

  it('dedupes label values case-insensitively', () => {
    const tags = [
      ['l', 'Booklist', 'ugc'],
      ['l', 'booklist', 'ugc']
    ]
    expect(extractNip32LabelValues(tags)).toEqual(['Booklist'])
  })

  it('formatNip32LabelSnippet prefers l tag values over content', () => {
    const event = {
      kind: 1985,
      content: 'ignored',
      tags: [
        ['L', 'license'],
        ['l', 'MIT', 'license']
      ]
    } as Event
    expect(formatNip32LabelSnippet(event)).toBe('MIT')
  })
})
