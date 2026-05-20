/** LUD-06 / LUD-12 LNURL-pay helpers (comment + callback URL). */

/** Default max comment length when metadata omits `commentAllowed` but we still show the field. */
export const LNURL_PAY_FALLBACK_COMMENT_ALLOWED = 255

export function parseLnurlCommentAllowed(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const n = Number(trimmed)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return 0
}

/**
 * Append LNURL-pay GET params to `callback` (LUD-06). Uses `URL` so existing query strings are preserved.
 */
export function buildLnurlPayCallbackUrl(
  callback: string,
  params: Record<string, string>
): string {
  const url = new URL(callback)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}
