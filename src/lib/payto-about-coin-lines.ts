/**
 * `XMR: 4abc…` / `BTC: bc1…` lines in kind 0 `about` (catalog-driven labels).
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import { buildPaytoUri } from '@/lib/payto'
import { getCanonicalPaytoType, getPaytoEditorTypeLabel, isKnownPaytoType } from '@/lib/payto-registry'
import type { Kind0ImportedPaymentMethod } from '@/lib/payto-kind0-import'

type PaytoAboutCoinCatalog = {
  kind0CryptocurrencyAddresses?: Record<string, string>
  aliases?: Record<string, string>
}

const catalog = paytoTypesCatalog as PaytoAboutCoinCatalog

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mapCoinLabelToPaytoType(label: string): string | null {
  const k = label.trim().toLowerCase()
  if (!k) return null
  const fromCrypto = catalog.kind0CryptocurrencyAddresses?.[k]
  if (fromCrypto) return getCanonicalPaytoType(fromCrypto)
  const canonical = getCanonicalPaytoType(k)
  return isKnownPaytoType(canonical) ? canonical : null
}

function buildAboutCoinLabelAlternation(): string {
  const labels = new Set<string>()
  const crypto = catalog.kind0CryptocurrencyAddresses ?? {}
  for (const key of Object.keys(crypto)) {
    labels.add(key)
    labels.add(key.toUpperCase())
  }
  for (const [alias, canonical] of Object.entries(catalog.aliases ?? {})) {
    if (crypto[alias] || Object.values(crypto).includes(canonical)) {
      labels.add(alias)
      labels.add(alias.toUpperCase())
    }
  }
  return [...labels]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
}

let aboutCoinLineRegex: RegExp | null = null

function getAboutCoinLineRegex(): RegExp | null {
  if (aboutCoinLineRegex) return aboutCoinLineRegex
  const alternation = buildAboutCoinLabelAlternation()
  if (!alternation) return null
  aboutCoinLineRegex = new RegExp(
    `(?:^|[\\n\\r])\\s*(${alternation})\\s*:\\s*([^\\s\\n]+)`,
    'gi'
  )
  return aboutCoinLineRegex
}

export type AboutCoinLineMatch = {
  coinLabel: string
  authority: string
  paytoType: string
  payto: string
  displayType: string
  /** Full matched segment including label and address (for content replacement). */
  raw: string
}

export function parseAboutCoinLabelPaymentLines(about: string): AboutCoinLineMatch[] {
  const text = about?.trim()
  if (!text) return []
  const regex = getAboutCoinLineRegex()
  if (!regex) return []

  const seen = new Set<string>()
  const out: AboutCoinLineMatch[] = []
  regex.lastIndex = 0

  for (const match of text.matchAll(regex)) {
    const coinLabel = match[1] ?? ''
    const authority = (match[2] ?? '').trim()
    if (!authority) continue
    const paytoType = mapCoinLabelToPaytoType(coinLabel)
    if (!paytoType) continue
    const dedupe = `${paytoType}:${authority.toLowerCase()}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push({
      coinLabel,
      authority,
      paytoType,
      payto: buildPaytoUri(paytoType, authority),
      displayType: getPaytoEditorTypeLabel(paytoType),
      raw: match[0]
    })
  }
  return out
}

export function extractAboutCoinPaymentMethods(about: string): Kind0ImportedPaymentMethod[] {
  return parseAboutCoinLabelPaymentLines(about).map((m) => ({
    type: m.paytoType,
    authority: m.authority,
    payto: m.payto,
    displayType: m.displayType
  }))
}

/** Split profile about text into plain segments and payto URIs for {@link parseContent}. */
export function parseAboutContentWithCoinPayto(content: string): import('@/lib/content-parser').TEmbeddedNode[] {
  const text = content
  if (!text) return [{ type: 'text', data: '' }]

  const regex = getAboutCoinLineRegex()
  if (!regex) return [{ type: 'text', data: text }]

  const result: import('@/lib/content-parser').TEmbeddedNode[] = []
  let lastIndex = 0
  regex.lastIndex = 0

  for (const match of text.matchAll(regex)) {
    const matchStart = match.index ?? 0
    const coinLabel = match[1] ?? ''
    const authority = (match[2] ?? '').trim()
    const paytoType = mapCoinLabelToPaytoType(coinLabel)
    if (!authority || !paytoType) continue

    if (matchStart > lastIndex) {
      result.push({ type: 'text', data: text.slice(lastIndex, matchStart) })
    }
    result.push({ type: 'payto', data: buildPaytoUri(paytoType, authority) })
    lastIndex = matchStart + match[0].length
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', data: text.slice(lastIndex) })
  }
  return result.length > 0 ? result : [{ type: 'text', data: text }]
}
