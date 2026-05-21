/**
 * payto: URI handling (RFC-8905 / NIP-A3) and payment targets.
 * Type metadata: {@link ./payto-registry}. Open / wallet URIs: {@link ./payto-targets}.
 */

import { getCanonicalPaytoType } from '@/lib/payto-registry'

export {
  getCanonicalPaytoType,
  getPaytoAuthorityFieldHelp,
  getPaytoEditorTypeLabel,
  getPaytoIconChar,
  getPaytoLogoPath,
  getPaytoLogoUrl,
  getPaytoTypeInfo,
  isKnownPaytoType,
  isLightningPaytoType,
  isZappableLightningPaytoType,
  isPaytoEditorCustomType,
  paytoEditorSelectTypes,
  PAYTO_EDITOR_OTHER_OPTION,
  PAYTO_EDITOR_TYPE_ORDER,
  PAYTO_KNOWN_TYPES,
  type PaytoAuthorityHelp,
  type PaytoCategory,
  type PaytoWalletOpenRow
} from '@/lib/payto-registry'

export {
  filterPaytoPaymentOpenHandlersForDevice,
  openPaytoPaymentTarget,
  resolvePaytoPaymentOpenHandlers,
  resolvePaytoProfileUrl,
  isPaytoHttpOpenUrl,
  isLikelyMobileWalletUserAgent,
  type PaytoPaymentOpenContext,
  type PaytoPaymentOpenHandler
} from '@/lib/payto-targets'

export const PAYTO_URI_REGEX = /payto:\/\/([a-z0-9-]+)\/([^\s\]\)\<\"']+)/gi

export interface ParsedPayto {
  type: string
  authority: string
  raw: string
}

export function parsePaytoUri(uri: string): ParsedPayto | null {
  const trimmed = uri.trim()
  const m = /^payto:\/\/([a-z0-9-]+)\/(.+)$/i.exec(trimmed)
  if (!m) return null
  const typeRaw = m[1].toLowerCase()
  const authority = decodeURIComponent(m[2].replace(/\+/g, ' '))
  if (!typeRaw || !authority) return null
  const type = getCanonicalPaytoType(typeRaw)
  return { type, authority, raw: trimmed }
}

export function buildPaytoUri(type: string, authority: string): string {
  const t = type.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const a = encodeURIComponent(authority.trim())
  return `payto://${t}/${a}`
}

export {
  flattenPaytoLinkChildText,
  formatPaytoLinkDisplayText,
  paytoLinkChildTextLooksLikeAuthority,
  PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS,
  truncatePaytoAuthority
} from '@/lib/payto-display'

export { extractKind0PaymentMethodsFromProfileJson, type Kind0ImportedPaymentMethod } from '@/lib/payto-kind0-import'

export {
  extractAboutCoinPaymentMethods,
  parseAboutContentWithCoinPayto,
  type AboutCoinLineMatch
} from '@/lib/payto-about-coin-lines'
