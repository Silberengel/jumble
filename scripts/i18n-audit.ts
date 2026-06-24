/**
 * Audit: t('...') keys in src vs en translation.
 * Run: node --experimental-strip-types scripts/i18n-audit.ts
 */
import en from '../src/i18n/locales/en.ts'
import { collectUsedTranslationKeys } from './i18n-collect-used-keys.ts'

const used = collectUsedTranslationKeys()
const enKeys = new Set(Object.keys(en.translation))
const missingInEn = [...used].filter((k) => !enKeys.has(k)).sort()
const orphanInEn = [...enKeys].filter((k) => !used.has(k)).sort()

console.log('Used keys:', used.size)
console.log('en keys:', enKeys.size)
console.log('Used but missing in en:', missingInEn.length)
if (missingInEn.length) console.log(missingInEn.join('\n'))
console.log('In en but unused:', orphanInEn.length)
if (orphanInEn.length) console.log(orphanInEn.slice(0, 50).join('\n'))
