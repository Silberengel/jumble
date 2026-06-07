/** Token is letters I/V/X/L/C/D/M only (case-insensitive). */
const ROMAN_LETTERS_ONLY = /^[mdclxvi]+$/i

/** Standard 1–3999 Roman numeral grammar. */
const ROMAN_NUMERAL_GRAMMAR =
  /^(?=[mdclxvi])m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i

export function isRomanNumeralToken(word: string): boolean {
  if (!word || !ROMAN_LETTERS_ONLY.test(word)) return false
  return ROMAN_NUMERAL_GRAMMAR.test(word)
}

/** Uppercase Roman-numeral words in titles (e.g. "Chapitre Iii" → "Chapitre III"). */
export function uppercaseRomanNumeralsInText(text: string): string {
  return text.replace(/\b([mdclxvi]{1,8})\b/gi, (match, word: string) => {
    if (!isRomanNumeralToken(word)) return match
    return word.toUpperCase()
  })
}
