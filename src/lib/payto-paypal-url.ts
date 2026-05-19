/**
 * Resolve PayPal payment targets to a browser-openable https URL.
 * Handles PayPal.Me slugs, paypal.com/paypalme/… paths, donation links, and YouTube redirect wrappers.
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

function ensureHttpsPaypalUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (/^(www\.)?paypal\.(com|me)(\/.+)?$/i.test(s)) {
    return `https://${s}`
  }
  return null
}

function parsePaypalInputUrl(input: string): URL | null {
  const withScheme = ensureHttpsPaypalUrl(input)
  if (!withScheme) return null
  try {
    const u = new URL(withScheme)
    if (isPaypalHostname(u.hostname)) return u
  } catch {
    return null
  }
  return null
}

export function isPaypalDonationUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'paypal.com') return false

  const path = u.pathname.toLowerCase()
  if (path.includes('/donate')) return true
  if (path.includes('/cgi-bin/webscr')) return true
  if (path.includes('/pools/')) return true
  if (path.includes('/fund/')) return true
  if (u.searchParams.has('hosted_button_id')) return true
  if (u.searchParams.get('cmd') === '_donations' || u.searchParams.get('cmd') === '_xclick') return true

  return false
}

/** Canonical https donate / hosted-button URL when possible. */
function normalizePaypalDonationUrl(u: URL): string {
  const hostedButtonId = u.searchParams.get('hosted_button_id')
  if (hostedButtonId) {
    return `https://www.paypal.com/donate/?hosted_button_id=${encodeURIComponent(hostedButtonId)}`
  }

  const out = new URL(u.toString())
  out.protocol = 'https:'
  const host = out.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'paypal.com') {
    out.hostname = 'www.paypal.com'
  }
  return out.toString()
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
    if (slug) return paypalMeUrlFromSlug(decodeAuthoritySegment(slug))
    return u.origin
  }

  const meMatch = u.pathname.match(/\/paypalme\/([^/?#]+)/i)
  if (meMatch?.[1]) {
    return paypalMeUrlFromSlug(decodeAuthoritySegment(meMatch[1]))
  }

  if (host === 'paypal.com' && isPaypalDonationUrl(u)) {
    return normalizePaypalDonationUrl(u)
  }

  return u.toString()
}

function paypalMeUrlFromSlug(slug: string): string {
  const trimmed = slug.trim()
  if (!trimmed) return 'https://paypal.me/'
  return `https://paypal.me/${encodeURIComponent(trimmed)}`
}

function extractPaypalMeSlugFromText(input: string): string | null {
  let s = input.trim()
  if (!s) return null

  if (/^payto:\/\/paypal\//i.test(s)) {
    return extractPaypalMeSlugFromText(s.replace(/^payto:\/\/paypal\//i, ''))
  }

  if (/^https?:\/\//i.test(s)) return null

  s = s
    .replace(/^www\./i, '')
    .replace(/^paypal\.me\//i, '')
    .replace(/^www\.paypal\.me\//i, '')
    .replace(/^paypal\.com\/paypalme\//i, '')

  if (!s || s.includes('/') || s.includes('?') || s.includes('#')) return null
  return decodeAuthoritySegment(s)
}

/**
 * Canonical PayPal.Me handle or donation URL for payto storage/display.
 */
export function normalizePaypalAuthority(authority: string): string {
  const trimmed = authority.trim()
  if (!trimmed) return trimmed

  const resolved = resolvePaypalPaymentUrl(trimmed)
  if (!resolved) return trimmed

  try {
    const u = new URL(resolved)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'paypal.me') {
      const slug = u.pathname.replace(/^\/+/, '').split('/')[0]
      if (slug) return decodeAuthoritySegment(slug)
    }
    if (host === 'paypal.com' && isPaypalDonationUrl(u)) {
      return resolved
    }
  } catch {
    /* keep trimmed */
  }
  return trimmed
}

/**
 * Turn a payto PayPal authority (username, email slug, donation link, or full URL) into an https URL for the browser.
 */
export function resolvePaypalPaymentUrl(authority: string): string | null {
  const trimmed = authority.trim()
  if (!trimmed) return null

  if (/^payto:\/\/paypal\//i.test(trimmed)) {
    return resolvePaypalPaymentUrl(trimmed.replace(/^payto:\/\/paypal\//i, ''))
  }

  const fromYoutube = extractNestedUrlFromYoutubeRedirect(trimmed)
  if (fromYoutube) return resolvePaypalPaymentUrl(fromYoutube)

  const parsed = parsePaypalInputUrl(trimmed)
  if (parsed) return normalizePaypalComOrMeUrl(parsed)

  const slug = extractPaypalMeSlugFromText(trimmed)
  if (slug) return paypalMeUrlFromSlug(slug)

  return null
}
