import { describe, expect, it } from 'vitest'
import { buildLanguageToolPreferenceList } from '@/lib/languagetool-language-order'

describe('buildLanguageToolPreferenceList', () => {
  it('puts client language first then en-US then de-DE', () => {
    const list = buildLanguageToolPreferenceList('de')
    expect(list[0]).toBe('de-DE')
    expect(list[1]).toBe('en-US')
    expect(list.includes('de-DE')).toBe(true)
    expect(list.indexOf('en-US')).toBe(1)
  })
})
