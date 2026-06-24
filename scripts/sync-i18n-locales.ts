/**
 * Regenerate locale files from keys used in src (orphans pruned).
 * Missing non-English strings fall back to English.
 *
 * Run: node --experimental-strip-types scripts/sync-i18n-locales.ts && npx prettier --write "src/i18n/locales/*.ts"
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cs from '../src/i18n/locales/cs.ts'
import de from '../src/i18n/locales/de.ts'
import en from '../src/i18n/locales/en.ts'
import es from '../src/i18n/locales/es.ts'
import fr from '../src/i18n/locales/fr.ts'
import nl from '../src/i18n/locales/nl.ts'
import pl from '../src/i18n/locales/pl.ts'
import ru from '../src/i18n/locales/ru.ts'
import tr from '../src/i18n/locales/tr.ts'
import zh from '../src/i18n/locales/zh.ts'
import { collectUsedTranslationKeys } from './i18n-collect-used-keys.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.join(__dirname, '..', 'src/i18n/locales')
const overridesDir = path.join(__dirname, 'i18n-overrides')

function loadOverrides(localeFile: string): Record<string, string> {
  if (localeFile === 'en.ts') return {}
  const p = path.join(overridesDir, localeFile.replace(/\.ts$/, '.json'))
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

const PACKAGES: { file: string; translation: Record<string, string>; header?: string }[] = [
  { file: 'cs.ts', translation: cs.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'de.ts', translation: de.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'en.ts', translation: en.translation },
  { file: 'es.ts', translation: es.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'fr.ts', translation: fr.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'nl.ts', translation: nl.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'pl.ts', translation: pl.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'ru.ts', translation: ru.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'tr.ts', translation: tr.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'zh.ts', translation: zh.translation, header: '// NOTE: Untranslated strings fall back to English.\n' }
]

function formatKey(k: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(k)) return k
  return JSON.stringify(k)
}

function formatValue(v: string): string {
  return JSON.stringify(v)
}

function emitLocaleFile(translation: Record<string, string>, keyOrder: string[], headerComment?: string): string {
  const lines: string[] = ['export default {', '  translation: {']
  if (headerComment) lines.push(`    ${headerComment}`)
  for (const k of keyOrder) {
    const v = translation[k]
    if (v === undefined) continue
    lines.push(`    ${formatKey(k)}: ${formatValue(v)},`)
  }
  lines.push('  }', '}', '')
  return lines.join('\n')
}

const used = collectUsedTranslationKeys()
const prevEn = { ...en.translation } as Record<string, string>
const prevKeys = Object.keys(prevEn)
const keptFromPrev = prevKeys.filter((k) => used.has(k))
const newOnly = [...used].filter((k) => !(k in prevEn)).sort()
const keyOrder = [...keptFromPrev, ...newOnly]
const pruned = prevKeys.length - keptFromPrev.length

const mergedEn: Record<string, string> = {}
for (const k of keyOrder) {
  mergedEn[k] = k in prevEn ? prevEn[k] : k
}

for (const pkg of PACKAGES) {
  const prev = pkg.translation as Record<string, string>
  const patch = loadOverrides(pkg.file)
  const out: Record<string, string> = {}
  for (const k of keyOrder) {
    const base = prev[k] !== undefined ? prev[k] : mergedEn[k]
    out[k] = patch[k] !== undefined ? patch[k] : base
  }
  const body = emitLocaleFile(out, keyOrder, pkg.header)
  fs.writeFileSync(path.join(localesDir, pkg.file), body, 'utf8')
}

console.log(
  'Keys:',
  keyOrder.length,
  '| New:',
  newOnly.length,
  '| Pruned:',
  pruned,
  '| Used in src:',
  used.size
)
