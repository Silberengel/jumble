import { describe, expect, it } from 'vitest'
import { isRomanNumeralToken, uppercaseRomanNumeralsInText } from '@/lib/roman-numeral-display'

describe('roman-numeral-display', () => {
  it('detects common chapter numerals', () => {
    expect(isRomanNumeralToken('iii')).toBe(true)
    expect(isRomanNumeralToken('Iv')).toBe(true)
    expect(isRomanNumeralToken('XII')).toBe(true)
    expect(isRomanNumeralToken('Introduction')).toBe(false)
  })

  it('uppercases title-cased Roman numerals in section titles', () => {
    expect(uppercaseRomanNumeralsInText('Chapitre Ii')).toBe('Chapitre II')
    expect(uppercaseRomanNumeralsInText('Chapitre Iii')).toBe('Chapitre III')
    expect(uppercaseRomanNumeralsInText('Chapitre Iv')).toBe('Chapitre IV')
    expect(uppercaseRomanNumeralsInText('Chapitre Vi')).toBe('Chapitre VI')
    expect(uppercaseRomanNumeralsInText('Chapitre Vii')).toBe('Chapitre VII')
    expect(uppercaseRomanNumeralsInText('Chapitre Viii')).toBe('Chapitre VIII')
    expect(uppercaseRomanNumeralsInText('Chapitre Ix')).toBe('Chapitre IX')
    expect(uppercaseRomanNumeralsInText('Chapter XII')).toBe('Chapter XII')
    expect(uppercaseRomanNumeralsInText('Introduction')).toBe('Introduction')
  })
})
