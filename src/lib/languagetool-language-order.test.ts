import { describe, expect, it } from 'vitest'
import {
  pickLanguageToolCodeForTranslateTarget,
  translateCodeHasLanguageToolPairing,
  translateTargetToLanguageToolCode
} from '@/lib/languagetool-language-order'
import { buildLabLanguageToolPreferenceList } from '@/lib/trinity-languages'

describe('translateTargetToLanguageToolCode', () => {
  it('maps ISO codes to LT variants', () => {
    expect(translateTargetToLanguageToolCode('ja')).toBe('ja-JP')
    expect(translateTargetToLanguageToolCode('de')).toBe('de-DE')
    expect(translateTargetToLanguageToolCode('zh-Hans')).toBe('zh-CN')
  })
})

describe('translateCodeHasLanguageToolPairing', () => {
  it('is true for mapped translate codes', () => {
    expect(translateCodeHasLanguageToolPairing('tr')).toBe(true)
    expect(translateCodeHasLanguageToolPairing('ja')).toBe(true)
  })
  it('is false for unknown codes', () => {
    expect(translateCodeHasLanguageToolPairing('zz')).toBe(false)
  })
})

describe('pickLanguageToolCodeForTranslateTarget', () => {
  it('returns mapped code when it appears in lab LT list', () => {
    const lt = buildLabLanguageToolPreferenceList('en', [
      { code: 'de', name: 'German' },
      { code: 'fr', name: 'French' }
    ])
    expect(pickLanguageToolCodeForTranslateTarget('de', lt)).toBe('de-DE')
  })
})

describe('buildLabLanguageToolPreferenceList', () => {
  it('only lists LT codes for installed translate targets (no extra UI language)', () => {
    const list = buildLabLanguageToolPreferenceList('de', [
      { code: 'fr', name: 'French' },
      { code: 'es', name: 'Spanish' }
    ])
    expect(list).toEqual(['fr-FR', 'es'])
  })

  it('prepends UI language and en-US when those targets are installed', () => {
    const list = buildLabLanguageToolPreferenceList('de', [
      { code: 'en', name: 'English' },
      { code: 'de', name: 'German' },
      { code: 'fr', name: 'French' }
    ])
    expect(list[0]).toBe('de-DE')
    expect(list[1]).toBe('en-US')
    expect(list).toEqual(['de-DE', 'en-US', 'fr-FR'])
  })
})
