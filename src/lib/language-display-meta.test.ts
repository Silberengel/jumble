import { describe, expect, it } from 'vitest'
import {
  buildResolvedTranslateMenuLanguageOptions,
  expandTranslateOptionsWithEnglishDialects,
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

  it('omits Japanese, Korean, and Swahili from default translate-target ordering', () => {
    expect(ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES).not.toContain('ja')
    expect(ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES).not.toContain('ko')
    expect(ORDERED_TRANSLATE_GRAMMAR_LANGUAGE_CODES).not.toContain('sw')
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

  it('drops Swahili even when the translate API advertises it', () => {
    const out = filterTranslateLanguagesWithGrammarCatalog([{ code: 'sw', name: 'Swahili' }])
    expect(out.map((l) => l.code)).toEqual([])
  })
})

describe('buildResolvedTranslateMenuLanguageOptions', () => {
  it('adds en-gb when API has en (no Swahili injection)', () => {
    const out = buildResolvedTranslateMenuLanguageOptions([
      { code: 'en', name: 'English' },
      { code: 'de', name: 'German' }
    ])
    expect(out.map((l) => l.code)).not.toContain('sw')
    expect(out.map((l) => l.code)).toContain('en-gb')
  })
})

describe('expandTranslateOptionsWithEnglishDialects', () => {
  it('inserts en-gb after plain en and relabels en as US English', () => {
    const out = expandTranslateOptionsWithEnglishDialects([
      { code: 'de', name: 'German' },
      { code: 'en', name: 'English' }
    ])
    expect(out.map((l) => l.code)).toEqual(['de', 'en', 'en-gb'])
    expect(out[1]!.name).toContain('United States')
    expect(out[2]!.name).toContain('United Kingdom')
  })

  it('is a no-op when en-gb is already present', () => {
    const base = [
      { code: 'en', name: 'English' },
      { code: 'en-gb', name: 'British' }
    ]
    expect(expandTranslateOptionsWithEnglishDialects(base)).toEqual(base)
  })
})

describe('translateLanguageOptionMatchesQuery', () => {
  it('matches code and English name', () => {
    expect(translateLanguageOptionMatchesQuery('de', '')).toBe(true)
    expect(translateLanguageOptionMatchesQuery('de', 'ger')).toBe(true)
    expect(translateLanguageOptionMatchesQuery('de', 'zzz')).toBe(false)
  })
})
