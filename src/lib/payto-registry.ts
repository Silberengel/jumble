/**
 * Payto type metadata from {@link ../data/payto-types.json}.
 * URI / “Open with” resolution lives in {@link ./payto-targets}.
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import { resolvePaytoLogoAssetPath } from '@/lib/payto-logos'
import { resolvePaypalPaymentUrl } from '@/lib/payto-paypal-url'

export type PaytoCategory =
  | 'bitcoin'
  | 'bitcoin-layer'
  | 'monero'
  | 'crypto'
  | 'stablecoin'
  | 'fiat'
  | 'tip'

export type PaytoAuthorityHelp = {
  placeholder: string
  hint: string
}

export type PaytoWalletAppBuilderId = 'phoenix' | 'zeus' | 'bluewallet' | 'ledger'

export type PaytoWalletAppRecord = {
  label: string
  mobileOnly?: boolean
  /** Used when {@link builder} is unset. Supports `{coinScheme}` and `{authority}`. */
  uriTemplate?: string
  /** Custom deep-link builder; takes precedence over {@link uriTemplate}. */
  builder?: PaytoWalletAppBuilderId
}

export type PaytoWalletOpenRow = {
  scheme?: string
  style?: 'path' | 'query'
  path?: string
  query?: Record<string, string>
  requireAtSign?: boolean
  requirePrefix?: string
  walletApps?: string[]
  /**
   * Per-app URI template overrides (e.g. Cake Wallet needs native `bitcoincash:` for BCH
   * because its wallet label is "bitcoin cash", not `bitcoincash`).
   */
  walletAppUriTemplates?: Record<string, string>
  /** When true, {@link walletApps} are hidden until PaytoDialog supplies a BOLT11 (see `_openWith.bolt11Invoice`). */
  deferWalletAppsUntilBolt11?: boolean
}

export type PaytoBolt11InvoiceOpenConfig = {
  paytoType?: string
  coinScheme?: string
  walletApps: string[]
}

export type PaytoOpenWithConfig = {
  bolt11Invoice?: PaytoBolt11InvoiceOpenConfig
}

export type PaytoTypeRecord = {
  label: string
  symbol?: string
  category: PaytoCategory
  logoAssetPath?: string
  profileUrlTemplate?: string
  /** PaytoDialog “Open with”: `paypal` uses the PayPal URL resolver only. */
  paymentOpen?: 'paypal'
  walletOpen?: PaytoWalletOpenRow
  authority?: PaytoAuthorityHelp
}

export type PaytoTypesCatalog = {
  _openWith?: PaytoOpenWithConfig
  walletApps?: Record<string, PaytoWalletAppRecord>
  editorOrder: string[]
  genericAuthorityHelp: PaytoAuthorityHelp
  aliases: Record<string, string>
  types: Record<string, PaytoTypeRecord>
  kind0CryptocurrencyAddresses?: Record<string, string>
  kind0RootPaymentFields?: Record<string, string>
}

const catalog = paytoTypesCatalog as PaytoTypesCatalog

export const PAYTO_EDITOR_TYPE_ORDER: readonly string[] = catalog.editorOrder
export const PAYTO_EDITOR_OTHER_OPTION = '__other__'

const GENERIC_AUTHORITY_HELP: PaytoAuthorityHelp = catalog.genericAuthorityHelp
const PAYTO_TYPE_ALIASES: Record<string, string> = catalog.aliases
const PAYTO_TYPES: Record<string, PaytoTypeRecord> = catalog.types

export const PAYTO_KNOWN_TYPES: Record<
  string,
  { label: string; symbol?: string; category: PaytoCategory }
> = Object.fromEntries(
  Object.entries(PAYTO_TYPES).map(([id, row]) => [
    id,
    { label: row.label, symbol: row.symbol, category: row.category }
  ])
)

export function getPaytoCatalog(): PaytoTypesCatalog {
  return catalog
}

export function getCanonicalPaytoType(type: string): string {
  const key = type.toLowerCase().trim()
  return PAYTO_TYPE_ALIASES[key] ?? key
}

export function getPaytoTypeRecord(type: string): PaytoTypeRecord | undefined {
  return PAYTO_TYPES[getCanonicalPaytoType(type)]
}

export function getWalletApp(appId: string): PaytoWalletAppRecord | undefined {
  return catalog.walletApps?.[appId]
}

export function getBolt11InvoiceOpenConfig(): PaytoBolt11InvoiceOpenConfig | undefined {
  const cfg = catalog._openWith?.bolt11Invoice
  if (!cfg?.walletApps?.length) return undefined
  return cfg
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

export function isPaytoEditorCustomType(type: string): boolean {
  const trimmed = type.trim()
  if (!trimmed || trimmed === PAYTO_EDITOR_OTHER_OPTION) return true
  return !isKnownPaytoType(trimmed)
}

export function paytoEditorSelectTypes(): string[] {
  return [...PAYTO_EDITOR_TYPE_ORDER, PAYTO_EDITOR_OTHER_OPTION]
}

export function getPaytoLogoPath(type: string): string | null {
  return resolvePaytoLogoAssetPath(getPaytoTypeRecord(type)?.logoAssetPath)
}

export function getPaytoLogoUrl(type: string): string | null {
  return getPaytoLogoPath(type)
}

export function getPaytoIconChar(type: string): string | null {
  return getPaytoTypeRecord(type)?.symbol ?? null
}

/** True when {@link PaytoTypeIcon} renders lightning, logo, or symbol — not the unknown fallback. */
export function paytoTypeHasDisplayIcon(type: string): boolean {
  const canonical = getCanonicalPaytoType(type)
  if (isLightningPaytoType(canonical)) return true
  if (getPaytoLogoPath(canonical)) return true
  if (getPaytoIconChar(canonical) != null) return true
  return false
}

export function isLightningPaytoType(type: string): boolean {
  const canonical = getCanonicalPaytoType(type)
  return canonical === 'lightning' || canonical === 'bip353'
}

export function isZappableLightningPaytoType(type: string): boolean {
  return getCanonicalPaytoType(type) === 'lightning'
}

/** Resolve PayPal targets; other types use {@link resolvePaytoProfileUrl} from payto-targets. */
export function resolvePaypalProfileUrl(authority: string): string | null {
  return resolvePaypalPaymentUrl(authority.trim())
}
