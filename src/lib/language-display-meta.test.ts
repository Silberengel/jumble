import { describe, expect, it } from 'vitest'
import { getLanguageDisplayParts, languageSelectSingleLine } from '@/lib/language-display-meta'

describe('getLanguageDisplayParts', () => {
  it('uses the static map for German', () => {
    const p = getLanguageDisplayParts('de')
    expect(p.codeLabel).toBe('de')
    expect(p.englishName).toBe('German')
    expect(p.nativeName).toBe('Deutsch')
  })

  it('uses regional map entries for LanguageTool-style tags', () => {
    const p = getLanguageDisplayParts('de-DE')
    expect(p.englishName).toBe('German (Germany)')
    expect(p.nativeName).toBe('Deutsch (Deutschland)')
  })

  it('formats a single-line label', () => {
    expect(languageSelectSingleLine('tr')).toContain('Turkish')
    expect(languageSelectSingleLine('tr')).toContain('Türkçe')
  })
})
