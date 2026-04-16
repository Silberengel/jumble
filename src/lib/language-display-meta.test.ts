import { describe, expect, it } from 'vitest'
import {
  filterTranslateLanguagesWithGrammarCatalog,
  getLanguageDisplayParts,
  languageSelectSingleLine,
  ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES,
  translateLanguageOptionMatchesQuery
} from '@/lib/language-display-meta'

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

describe('ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES', () => {
  it('lists map ∩ LanguageTool with Turkish and a large set', () => {
    expect(ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES).toContain('tr')
    expect(ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES.length).toBeGreaterThan(40)
  })
})

describe('filterTranslateLanguagesWithGrammarCatalog', () => {
  it('keeps only API languages that pair with LT, in catalog order', () => {
    const out = filterTranslateLanguagesWithGrammarCatalog([
      { code: 'tr', name: 'Turkish' },
      { code: 'zz-fake', name: 'Fake' },
      { code: 'de', name: 'German' }
    ])
    expect(out.map((l) => l.code)).toEqual(['de', 'tr'])
  })
})

describe('translateLanguageOptionMatchesQuery', () => {
  it('matches code and English name', () => {
    expect(translateLanguageOptionMatchesQuery('de', '')).toBe(true)
    expect(translateLanguageOptionMatchesQuery('de', 'ger')).toBe(true)
    expect(translateLanguageOptionMatchesQuery('de', 'zzz')).toBe(false)
  })
})
