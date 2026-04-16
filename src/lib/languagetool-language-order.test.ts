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
  it('puts client language first then en-US then LT codes from translate options', () => {
    const list = buildLabLanguageToolPreferenceList('de', [
      { code: 'fr', name: 'French' },
      { code: 'es', name: 'Spanish' }
    ])
    expect(list[0]).toBe('de-DE')
    expect(list[1]).toBe('en-US')
    expect(list.includes('de-DE')).toBe(true)
    expect(list.indexOf('en-US')).toBe(1)
    expect(list.includes('fr-FR')).toBe(true)
    expect(list.includes('es')).toBe(true)
  })
})
