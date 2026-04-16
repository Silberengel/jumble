import { describe, expect, it } from 'vitest'
import { filterTranslateLanguagesWithLanguageToolPairing } from '@/lib/trinity-languages'

describe('filterTranslateLanguagesWithLanguageToolPairing', () => {
  it('dedupes by LanguageTool grammar code and prefers shorter API codes', () => {
    const list = filterTranslateLanguagesWithLanguageToolPairing([
      { code: 'zh-CN', name: 'Chinese (Simplified)' },
      { code: 'zh', name: 'Chinese' },
      { code: 'de', name: 'German' }
    ])
    expect(list.map((l) => l.code).sort()).toEqual(['de', 'zh'])
  })

  it('drops codes with no LT pairing', () => {
    const list = filterTranslateLanguagesWithLanguageToolPairing([
      { code: 'en', name: 'English' },
      { code: 'zz-fake', name: 'Fake' }
    ])
    expect(list.map((l) => l.code)).toEqual(['en'])
  })
})
