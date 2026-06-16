import { describe, expect, it } from 'vitest'
import { buildCitationWikiMacro } from '@/lib/citation-macro'

describe('buildCitationWikiMacro', () => {
  it('wraps bech32 id in citation macro', () => {
    expect(buildCitationWikiMacro('inline', 'nevent1abc')).toBe('[[citation::inline::nevent1abc]]')
  })

  it('strips nostr: prefix from id', () => {
    expect(buildCitationWikiMacro('end', 'nostr:nevent1xyz')).toBe('[[citation::end::nevent1xyz]]')
  })
})
