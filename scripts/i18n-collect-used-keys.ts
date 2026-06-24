/**
 * Collect translation keys referenced from application source.
 * Shared by i18n:audit and i18n:sync.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RELAY_SOURCE_TYPES = [
  'local',
  'relay_list',
  'http_relay_list',
  'client_default',
  'open_from',
  'favorite',
  'relay_set',
  'contextual',
  'randomly_selected'
] as const

const PAYTO_CATEGORIES = [
  'bitcoin',
  'bitcoin-layer',
  'monero',
  'crypto',
  'stablecoin',
  'fiat',
  'tip'
] as const

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'locales') continue
      walk(p, acc)
    } else if (/\.(tsx|ts)$/.test(name)) {
      acc.push(p)
    }
  }
  return acc
}

function unquoteSingle(s: string) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}
function unquoteDouble(s: string) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function extractTKeys(content: string): Set<string> {
  const keys = new Set<string>()
  const re1 = /\bt\(\s*'((?:\\.|[^'\\])*)'/g
  let m
  while ((m = re1.exec(content)) !== null) {
    const raw = unquoteSingle(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  const re2 = /\bt\(\s*"((?:\\.|[^"\\])*)"/g
  while ((m = re2.exec(content)) !== null) {
    const raw = unquoteDouble(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  const re3 = /i18n\.t\(\s*'((?:\\.|[^'\\])*)'/g
  while ((m = re3.exec(content)) !== null) {
    const raw = unquoteSingle(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  const re4 = /i18n\.t\(\s*"((?:\\.|[^"\\])*)"/g
  while ((m = re4.exec(content)) !== null) {
    const raw = unquoteDouble(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  const re5 = /labelKey:\s*'((?:\\.|[^'\\])*)'/g
  while ((m = re5.exec(content)) !== null) {
    keys.add(unquoteSingle(m[1]))
  }
  const re6 = /labelKey:\s*"((?:\\.|[^"\\])*)"/g
  while ((m = re6.exec(content)) !== null) {
    keys.add(unquoteDouble(m[1]))
  }
  // `as const` arrays passed to t(labelKey) in Advanced Event Lab, etc.
  for (const match of content.matchAll(/'((?:Advanced lab|BlossomUpload)[^']*)'/g)) {
    keys.add(match[1])
  }
  return keys
}

/** Keys returned from composerBlockReasonMessageKey (t(key) in composer-block-reason.ts). */
function composerBlockReasonKeys(): string[] {
  return [
    'readOnlySession.cannotPublish',
    'Publishing...',
    'Uploading...',
    'Write something...',
    'Publish relay cap hint',
    'Add at least two poll options',
    'Add recipients using nostr: mentions (e.g., nostr:npub1...) or open Advanced',
    'Highlight source is required',
    'Web bookmark URL is required',
    'Fill required citation fields',
    'Music track title and audio URL are required',
    'Fill required discussion thread fields'
  ]
}

export function collectUsedTranslationKeys(srcDir = path.join(__dirname, '..', 'src')): Set<string> {
  const used = new Set<string>()
  for (const f of walk(srcDir)) {
    if (f.includes(`${path.sep}i18n${path.sep}locales${path.sep}`)) continue
    const content = fs.readFileSync(f, 'utf8')
    for (const k of extractTKeys(content)) used.add(k)
  }
  for (const k of composerBlockReasonKeys()) used.add(k)
  for (const c of PAYTO_CATEGORIES) used.add(`paytoCategory.${c}`)
  for (const t of RELAY_SOURCE_TYPES) used.add(`relayType_${t}`)
  return used
}
