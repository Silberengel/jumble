/**
 * Loads payto type metadata from {@link ../data/payto-types.json}.
 * Edit that JSON to add types, editor order, hints, logos, and profile URL templates.
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import { resolvePaytoLogoAssetPath } from '@/lib/payto-logos'
import { getPaytoPrimaryOpenUrl } from '@/lib/payto-wallet-open'
import { resolvePaypalPaymentUrl } from '@/lib/payto-paypal-url'

export type PaytoCategory = 'bitcoin' | 'bitcoin-layer' | 'crypto' | 'stablecoin' | 'fiat' | 'tip'

export type PaytoAuthorityHelp = {
  placeholder: string
  hint: string
}

export type PaytoWalletOpenRow = {
  scheme?: string
  style?: 'path' | 'query'
  path?: string
  query?: Record<string, string>
  requireAtSign?: boolean
  requirePrefix?: string
  walletApps?: string[]
  /** When true, {@link walletApps} are hidden until PaytoDialog has a BOLT11 (see catalog `_openWith.bolt11Invoice`). */
  deferWalletAppsUntilBolt11?: boolean
}

export type PaytoTypeRecord = {
  label: string
  symbol?: string
  category: PaytoCategory
  /** Repo-relative path, e.g. `src/assets/payto_logos/ethereum-eth-logo.svg`. */
  logoAssetPath?: string
  profileUrlTemplate?: string
  /** PaytoDialog “Open with” mode; `paypal` uses the PayPal URL resolver only. */
  paymentOpen?: 'paypal'
  /** Native wallet URI / app deep link (see {@link getPaytoPrimaryOpenUrl}). */
  walletOpen?: PaytoWalletOpenRow
  authority?: PaytoAuthorityHelp
}

type PaytoTypesCatalogJson = {
  editorOrder: string[]
  genericAuthorityHelp: PaytoAuthorityHelp
  aliases: Record<string, string>
  types: Record<string, PaytoTypeRecord>
}

const catalog = paytoTypesCatalog as PaytoTypesCatalogJson

export const PAYTO_EDITOR_TYPE_ORDER: readonly string[] = catalog.editorOrder

/** Select value: opens free-text payto type field (not published as this literal). */
export const PAYTO_EDITOR_OTHER_OPTION = '__other__'

const GENERIC_AUTHORITY_HELP: PaytoAuthorityHelp = catalog.genericAuthorityHelp

const PAYTO_TYPE_ALIASES: Record<string, string> = catalog.aliases

const PAYTO_TYPES: Record<string, PaytoTypeRecord> = catalog.types

/** UI summary per canonical type (label, symbol, category). */
export const PAYTO_KNOWN_TYPES: Record<
  string,
  { label: string; symbol?: string; category: PaytoCategory }
> = Object.fromEntries(
  Object.entries(PAYTO_TYPES).map(([id, row]) => [
    id,
    { label: row.label, symbol: row.symbol, category: row.category }
  ])
)

export function getCanonicalPaytoType(type: string): string {
  const key = type.toLowerCase().trim()
  return PAYTO_TYPE_ALIASES[key] ?? key
}

export function getPaytoTypeRecord(type: string): PaytoTypeRecord | undefined {
  return PAYTO_TYPES[getCanonicalPaytoType(type)]
}

export function getPaytoTypeInfo(type: string): (typeof PAYTO_KNOWN_TYPES)[string] | undefined {
  return PAYTO_KNOWN_TYPES[getCanonicalPaytoType(type)]
}

export function isKnownPaytoType(type: string): boolean {
  return getCanonicalPaytoType(type) in PAYTO_KNOWN_TYPES
}

export function getPaytoAuthorityFieldHelp(type: string): PaytoAuthorityHelp {
  const row = getPaytoTypeRecord(type)
  return row?.authority ?? GENERIC_AUTHORITY_HELP
}

export function getPaytoEditorTypeLabel(type: string): string {
  return getPaytoTypeInfo(type)?.label ?? getCanonicalPaytoType(type)
}

/** True when the row uses a custom payto type (Other selected or unknown type from JSON). */
export function isPaytoEditorCustomType(type: string): boolean {
  const trimmed = type.trim()
  if (!trimmed || trimmed === PAYTO_EDITOR_OTHER_OPTION) return true
  return !isKnownPaytoType(trimmed)
}

/** Dropdown options: catalog presets plus “Other”. */
export function paytoEditorSelectTypes(): string[] {
  return [...PAYTO_EDITOR_TYPE_ORDER, PAYTO_EDITOR_OTHER_OPTION]
}

/** Bundled asset URL for `<img src>` (resolved from catalog `logoAssetPath`). */
export function getPaytoLogoPath(type: string): string | null {
  return resolvePaytoLogoAssetPath(getPaytoTypeRecord(type)?.logoAssetPath)
}

/** Same as {@link getPaytoLogoPath}; alias for callers that expect a URL field name. */
export function getPaytoLogoUrl(type: string): string | null {
  return getPaytoLogoPath(type)
}

export function getPaytoProfileUrl(type: string, authority: string): string | null {
  if (!authority.trim()) return null

  const canonical = getCanonicalPaytoType(type)
  if (canonical === 'paypal') {
    return resolvePaypalPaymentUrl(authority)
  }

  const fromWallet = getPaytoPrimaryOpenUrl(type, authority)
  if (fromWallet) return fromWallet

  const template = getPaytoTypeRecord(type)?.profileUrlTemplate
  if (!template) return null
  return template.replace('{authority}', encodeURIComponent(authority.trim()))
}

export function getPaytoIconChar(type: string): string | null {
  return getPaytoTypeRecord(type)?.symbol ?? null
}

/** LUD-16 / LNURL lightning and BIP-353 DNS instructions — payment UI, not on-chain Bitcoin. */
export function isLightningPaytoType(type: string): boolean {
  const canonical = getCanonicalPaytoType(type)
  return canonical === 'lightning' || canonical === 'bip353'
}

/** Lightning targets that support zaps (LUD-16 / LNURL only; BIP-353 is pay/copy, not zappable). */
export function isZappableLightningPaytoType(type: string): boolean {
  return getCanonicalPaytoType(type) === 'lightning'
}
