import { describe, expect, it } from 'vitest'
import { detectReadAloudContentLanguage } from '@/lib/read-aloud-content-language'

describe('detectReadAloudContentLanguage', () => {
  it('detects German from umlauts', () => {
    expect(detectReadAloudContentLanguage('Grüße aus München und Spaß')).toBe('de')
  })

  it('detects plain ASCII English', () => {
    expect(detectReadAloudContentLanguage('Hello this is a test note about nothing special.')).toBe('en')
  })

  it('prefers British English when UK spellings dominate', () => {
    const s =
      'The colour of the behaviour was odd; we organised a favourable defence of the centre.'
    expect(detectReadAloudContentLanguage(s)).toBe('en-gb')
  })

  it('prefers US English when American spellings dominate', () => {
    const s = 'The color and behavior at the center were organized with a traveling neighbor.'
    expect(detectReadAloudContentLanguage(s)).toBe('en')
  })

  it('detects Russian from Cyrillic', () => {
    expect(detectReadAloudContentLanguage('Привет мир это тест')).toBe('ru')
  })

  it('detects Polish', () => {
    expect(detectReadAloudContentLanguage('Cześć, to jest żółć i łódź.')).toBe('pl')
  })

  it('detects Turkish from distinctive letters (avoid ü so German is not triggered)', () => {
    expect(detectReadAloudContentLanguage('Merhaba, dağ ve şeker \u0130stanbul.')).toBe('tr')
  })
})
