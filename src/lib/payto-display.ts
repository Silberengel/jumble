import { Children, isValidElement, type ReactNode } from 'react'
import { getPaytoTypeInfo } from '@/lib/payto-registry'

export const PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS = 10

/** First N characters of a payto authority for inline feed/article display. */
export function truncatePaytoAuthority(
  authority: string,
  maxLen = PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS
): string {
  const trimmed = authority.trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen)
}

/**
 * Inline payto label for Markdown/AsciiDoc/notes: `47R4Npvudm... (Monero)`.
 */
export function formatPaytoLinkDisplayText(
  type: string,
  authority: string,
  options?: { label?: string; maxAuthorityChars?: number }
): string {
  const info = getPaytoTypeInfo(type)
  const label = (options?.label ?? info?.label ?? type).trim()
  const maxLen = options?.maxAuthorityChars ?? PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS
  const trimmed = authority.trim()
  const short = truncatePaytoAuthority(trimmed, maxLen)
  const suffix = trimmed.length > short.length ? '...' : ''
  return `${short}${suffix} (${label})`
}

/** True when link text is just the raw address/URI (replace with compact display). */
export function paytoLinkChildTextLooksLikeAuthority(
  childText: string,
  authority: string,
  raw: string
): boolean {
  const t = childText.trim()
  if (!t) return true
  const auth = authority.trim()
  const uri = raw.trim()
  if (t === auth || t === uri) return true
  if (/^payto:\/\//i.test(t)) return true
  if (auth.length > PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS) {
    if (t === auth || t.startsWith(auth.slice(0, PAYTO_INLINE_DISPLAY_AUTHORITY_CHARS))) {
      return true
    }
  }
  return false
}

/** Plain text from PaytoLink child nodes (for detecting raw-address link labels). */
export function flattenPaytoLinkChildText(children: ReactNode): string {
  const parts: string[] = []
  Children.forEach(children, (child) => {
    if (child == null || typeof child === 'boolean') return
    if (typeof child === 'string' || typeof child === 'number') {
      parts.push(String(child))
      return
    }
    if (isValidElement(child) && child.props.children != null) {
      parts.push(flattenPaytoLinkChildText(child.props.children))
    }
  })
  return parts.join('')
}
