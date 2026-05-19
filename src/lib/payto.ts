/**
 * payto: URI handling (RFC-8905 / NIP-A3)
 * Type metadata lives in {@link ../data/payto-types.json} via {@link ./payto-registry}.
 */

import { getCanonicalPaytoType } from '@/lib/payto-registry'

export {
  getCanonicalPaytoType,
  getPaytoAuthorityFieldHelp,
  getPaytoEditorTypeLabel,
  getPaytoIconChar,
  getPaytoLogoPath,
  getPaytoLogoUrl,
  getPaytoProfileUrl,
  getPaytoTypeInfo,
  isKnownPaytoType,
  isLightningPaytoType,
  paytoEditorSelectTypes,
  PAYTO_EDITOR_TYPE_ORDER,
  PAYTO_KNOWN_TYPES,
  type PaytoAuthorityHelp,
  type PaytoCategory
} from '@/lib/payto-registry'

export const PAYTO_URI_REGEX = /payto:\/\/([a-z0-9-]+)\/([^\s\]\)\<\"']+)/gi

export interface ParsedPayto {
  type: string
  authority: string
  raw: string
}

/**
 * Parse a payto URI into type and authority. Returns null if invalid.
 */
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

/**
 * Build payto URI from type and authority.
 */
export function buildPaytoUri(type: string, authority: string): string {
  const t = type.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const a = encodeURIComponent(authority.trim())
  return `payto://${t}/${a}`
}
