/**
 * Fill scripts/i18n-overrides/de.json using remote LibreTranslate.
 * Preserves {{interpolation}} tokens. Skips URLs and mostly-technical strings.
 *
 * Run: node --experimental-strip-types scripts/i18n-translate-de-remote.ts
 * Then: npm run i18n:sync
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import en from '../src/i18n/locales/en.ts'
import de from '../src/i18n/locales/de.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRANSLATE_URL =
  process.env.I18N_TRANSLATE_URL?.trim() || 'https://jumble.imwald.eu/api/translate/translate'
const BATCH_SIZE = Number(process.env.I18N_TRANSLATE_BATCH ?? 25)
const DELAY_MS = Number(process.env.I18N_TRANSLATE_DELAY_MS ?? 400)
const overridesDir = path.join(__dirname, 'i18n-overrides')
const overridesPath = path.join(overridesDir, 'de.json')

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function shouldSkipTranslation(text: string) {
  const t = text.trim()
  if (!t) return true
  if (/^https?:\/\//i.test(t)) return true
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(t)) return true
  if (/^(npub|nevent|naddr|note1|kind|pubkey|sig|tags|id|Git|RSS|HTTP|Tor|I2P|JSON|AM|PM|R & W|Feed|sats|satoshi|satoshis|piconero|piconeros)$/i.test(t))
    return true
  return false
}

function protectPlaceholders(text: string) {
  const map = new Map<string, string>()
  let i = 0
  const protectedText = text.replace(/\{\{[^}]+\}\}/g, (m) => {
    const token = `__PH${i}__`
    map.set(token, m)
    i += 1
    return token
  })
  return { protectedText, map }
}

function restorePlaceholders(text: string, map: Map<string, string>) {
  let out = text
  for (const [token, orig] of map) {
    out = out.split(token).join(orig)
  }
  return out
}

async function translateBatch(items: { protectedText: string; map: Map<string, string> }[]) {
  const payloads = items.map(({ protectedText }) => protectedText)
  const res = await fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: payloads,
      source: 'en',
      target: 'de',
      format: 'text'
    })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Translate HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { translatedText: string | string[] }
  const texts = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText]
  if (texts.length !== items.length) {
    throw new Error(`Expected ${items.length} translations, got ${texts.length}`)
  }
  return texts.map((translated, idx) => restorePlaceholders(translated, items[idx].map))
}

function loadExistingOverrides(): Record<string, string> {
  if (!fs.existsSync(overridesPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

const existingOverrides = loadExistingOverrides()
const gaps: { key: string; enVal: string }[] = []

for (const key of Object.keys(en.translation)) {
  const enVal = en.translation[key]
  const deVal = de.translation[key]
  if (deVal !== enVal) continue
  if (existingOverrides[key] && existingOverrides[key] !== enVal) continue
  if (shouldSkipTranslation(enVal)) continue
  gaps.push({ key, enVal })
}

console.log(`Translating ${gaps.length} strings via ${TRANSLATE_URL} (batch ${BATCH_SIZE})…`)

const out: Record<string, string> = { ...existingOverrides }
let done = 0
let failed = 0

for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
  const chunk = gaps.slice(i, i + BATCH_SIZE)
  const prepared = chunk.map(({ enVal }) => protectPlaceholders(enVal))
  try {
    const translated = await translateBatch(prepared)
    for (let j = 0; j < chunk.length; j++) {
      out[chunk[j].key] = translated[j]
      done += 1
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, gaps.length)}/${gaps.length}`)
  } catch (err) {
    failed += chunk.length
    console.error(`\nBatch ${i}-${i + chunk.length} failed:`, (err as Error).message)
  }
  if (i + BATCH_SIZE < gaps.length) await sleep(DELAY_MS)
}

console.log(`\nDone: ${done} translated, ${failed} failed, ${Object.keys(out).length} overrides total`)

fs.mkdirSync(overridesDir, { recursive: true })
fs.writeFileSync(overridesPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
console.log(`Wrote ${overridesPath}`)
