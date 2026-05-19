/**
 * Resolve PayPal payment targets to a browser-openable https URL.
 * Handles PayPal.Me slugs, paypal.com/paypalme/… paths, donate links, and YouTube redirect wrappers.
 */

const PAYPAL_HOSTS = new Set(['paypal.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me'])

function isPaypalHostname(hostname: string): boolean {
  return PAYPAL_HOSTS.has(hostname.toLowerCase())
}

/** Decode once; leave valid path characters (e.g. @ in PayPal.Me) unescaped for display URLs. */
function decodeAuthoritySegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, ' '))
  } catch {
    return segment
  }
}

function extractNestedUrlFromYoutubeRedirect(input: string): string | null {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (!host.includes('youtube.com') && !host.includes('youtu.be')) return null

  for (const key of ['q', 'u', 'url']) {
    const raw = u.searchParams.get(key)
    if (!raw?.trim()) continue
    try {
      const nested = decodeURIComponent(raw.trim())
      if (/^https?:\/\//i.test(nested) || nested.toLowerCase().includes('paypal')) {
        return nested
      }
    } catch {
      continue
    }
  }
  return null
}

function normalizePaypalComOrMeUrl(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'paypal.me') {
    const slug = u.pathname.replace(/^\/+/, '').split('/')[0]
    if (slug) return `https://paypal.me/${decodeAuthoritySegment(slug)}`
    return u.origin
  }

  const meMatch = u.pathname.match(/\/paypalme\/([^/?#]+)/i)
  if (meMatch?.[1]) {
    return `https://paypal.me/${decodeAuthoritySegment(meMatch[1])}`
  }

  // Donate / hosted button / payment links — open as published
  return u.toString()
}

function extractPaypalMeSlugFromText(input: string): string | null {
  let s = input.trim()
  if (!s) return null

  s = s.replace(/^payto:\/\/paypal\//i, '')

  if (/^https?:\/\//i.test(s)) return null

  s = s
    .replace(/^www\./i, '')
    .replace(/^paypal\.me\//i, '')
    .replace(/^paypal\.com\/paypalme\//i, '')

  if (!s || s.includes('/') || s.includes('?') || s.includes('#')) return null
  return decodeAuthoritySegment(s)
}

/**
 * Turn a payto PayPal authority (username, email slug, or full URL) into an https URL for the browser.
 */
export function resolvePaypalPaymentUrl(authority: string): string | null {
  const trimmed = authority.trim()
  if (!trimmed) return null

  const fromYoutube = extractNestedUrlFromYoutubeRedirect(trimmed)
  if (fromYoutube) return resolvePaypalPaymentUrl(fromYoutube)

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      if (isPaypalHostname(u.hostname)) return normalizePaypalComOrMeUrl(u)
    } catch {
      return null
    }
  }

  const slug = extractPaypalMeSlugFromText(trimmed)
  if (slug) return `https://paypal.me/${slug}`

  return null
}
