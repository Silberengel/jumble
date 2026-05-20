/**
 * Kind 0 JSON payment hints (incl. Garnet {@code cryptocurrency_addresses}) → payto methods.
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import { buildPaytoUri } from '@/lib/payto'
import { extractAboutCoinPaymentMethods } from '@/lib/payto-about-coin-lines'
import { getCanonicalPaytoType, getPaytoEditorTypeLabel, isKnownPaytoType } from '@/lib/payto-registry'

export type Kind0ImportedPaymentMethod = {
  type: string
  authority: string
  payto: string
  displayType: string
}

type PaytoKind0ImportCatalog = {
  kind0CryptocurrencyAddresses?: Record<string, string>
  kind0RootPaymentFields?: Record<string, string>
}

const importCatalog = paytoTypesCatalog as PaytoKind0ImportCatalog

function mapExternalKeyToPaytoType(externalKey: string): string | null {
  const k = externalKey.trim().toLowerCase()
  if (!k) return null
  const fromCrypto = importCatalog.kind0CryptocurrencyAddresses?.[k]
  if (fromCrypto) return getCanonicalPaytoType(fromCrypto)
  const fromRoot = importCatalog.kind0RootPaymentFields?.[k]
  if (fromRoot) return getCanonicalPaytoType(fromRoot)
  const canonical = getCanonicalPaytoType(k)
  return isKnownPaytoType(canonical) ? canonical : null
}

function readStringAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return s.length > 0 ? s : null
}

/**
 * Extract payto-shaped methods from parsed kind 0 metadata JSON.
 * Supports Garnet `cryptocurrency_addresses` and legacy top-level coin keys.
 */
export function extractKind0PaymentMethodsFromProfileJson(
  profileJson: unknown
): Kind0ImportedPaymentMethod[] {
  if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
    return []
  }

  const obj = profileJson as Record<string, unknown>
  const seen = new Set<string>()
  const out: Kind0ImportedPaymentMethod[] = []

  const push = (externalKey: string, address: string) => {
    const paytoType = mapExternalKeyToPaytoType(externalKey)
    if (!paytoType) return
    const authority = address.trim()
    if (!authority) return
    const dedupe = `${paytoType}:${authority.toLowerCase()}`
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    out.push({
      type: paytoType,
      authority,
      payto: buildPaytoUri(paytoType, authority),
      displayType: getPaytoEditorTypeLabel(paytoType)
    })
  }

  const cryptoBlock = obj.cryptocurrency_addresses
  if (cryptoBlock && typeof cryptoBlock === 'object' && !Array.isArray(cryptoBlock)) {
    for (const [key, value] of Object.entries(cryptoBlock as Record<string, unknown>)) {
      const addr = readStringAddress(value)
      if (addr) push(key, addr)
    }
  }

  const rootKeys = importCatalog.kind0RootPaymentFields ?? {}
  for (const externalKey of Object.keys(rootKeys)) {
    const addr = readStringAddress(obj[externalKey])
    if (addr) push(externalKey, addr)
  }

  const about = obj.about
  if (typeof about === 'string' && about.trim()) {
    for (const m of extractAboutCoinPaymentMethods(about)) {
      push(m.type, m.authority)
    }
  }

  return out
}
