import { describe, expect, it } from 'vitest'
import {
  buildLanguageToolPreferenceList,
  pickLanguageToolCodeForTranslateTarget,
  translateTargetToLanguageToolCode
} from '@/lib/languagetool-language-order'

describe('translateTargetToLanguageToolCode', () => {
  it('maps ISO codes to LT variants', () => {
    expect(translateTargetToLanguageToolCode('ja')).toBe('ja-JP')
    expect(translateTargetToLanguageToolCode('de')).toBe('de-DE')
    expect(translateTargetToLanguageToolCode('zh-Hans')).toBe('zh-CN')
  })
})

describe('pickLanguageToolCodeForTranslateTarget', () => {
  it('returns mapped code when it appears in ltList', () => {
    const lt = buildLanguageToolPreferenceList('en')
    expect(pickLanguageToolCodeForTranslateTarget('ja', lt)).toBe('ja-JP')
  })
})

describe('buildLanguageToolPreferenceList', () => {
  it('puts client language first then en-US then de-DE', () => {
    const list = buildLanguageToolPreferenceList('de')
    expect(list[0]).toBe('de-DE')
    expect(list[1]).toBe('en-US')
    expect(list.includes('de-DE')).toBe(true)
    expect(list.indexOf('en-US')).toBe(1)
  })
})
