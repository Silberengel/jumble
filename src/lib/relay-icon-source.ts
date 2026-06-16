import { MONERO_NOSTR_RELAY_URLS, NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { normalizeFaviconDomain } from '@/lib/favicon-fail-cache'
import { normalizeUrl } from '@/lib/url'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'

/**
 * Sovbit operator mark — relay subdomains serve HTML that references `/favicon.ico` but that path 404s;
 * the working asset lives on the main site.
 * @see https://sovbit.host/
 */
export const SOVBIT_HOST_ICON_SRC = 'https://sovbit.host/images/favicon.ico'

/**
 * Nostr Archives front-site favicon for trending shards, search relay, and related hosts.
 * @see https://nostrarchives.com/
 */
export const NOSTRARCHIVES_SITE_ICON_SRC = 'https://nostrarchives.com/favicon.ico'

/**
 * Nerostr / PMNR relay mark — NIP-11 omits `icon`; landing pages use `/static/assets/nerostr.webp`.
 * @see https://nostr.xmr.rocks/
 */
export const NEROST_RELAY_ICON_SRC = 'https://nostr.xmr.rocks/static/assets/nerostr.webp'

/**
 * nostr.land mark from NIP-11 — `/favicon.ico` 404s; relay serves icon on nostr.build CDN.
 * @see https://nostr.land/
 */
export const NOSTR_LAND_ICON_SRC = 'https://i.nostr.build/j6xguiCQRrdk6MsL.jpg'

function hostMatchesDomainSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

function isSovbitBrandedHost(host: string): boolean {
  return hostMatchesDomainSuffix(host, 'sovbit.host')
}

function isNostrArchivesBrandedHost(host: string): boolean {
  return hostMatchesDomainSuffix(host, 'nostrarchives.com')
}

function isNostrLandBrandedHost(host: string): boolean {
  return hostMatchesDomainSuffix(host, 'nostr.land')
}

/** NIP-05 apex domains and relay hostnames for PMNR / Nosmero branding. */
const MONERO_NOSTR_BRANDED_DOMAIN_SUFFIXES = [
  'xmr.rocks',
  'usenostr.org',
  'ithurtswhenip.ee',
  'nosmero.com'
] as const

function isMoneroNostrBrandedHost(host: string): boolean {
  if (MONERO_NOSTR_RELAY_HOSTS.has(host)) return true
  return MONERO_NOSTR_BRANDED_DOMAIN_SUFFIXES.some((suffix) => hostMatchesDomainSuffix(host, suffix))
}

/** Same branding as Wisp trending — nostrarchives.com favicon in {@link RelayIcon}. */
export function isNostrArchivesBrandedRelayUrl(url: string | undefined): boolean {
  if (!url) return false
  if (isWispTrendingNotesRelayUrl(url)) return true
  const norm = (normalizeUrl(url) || url).trim().toLowerCase()
  if (norm === (normalizeUrl(NOSTR_ARCHIVES_SEARCH_RELAY_URL) || NOSTR_ARCHIVES_SEARCH_RELAY_URL).toLowerCase()) {
    return true
  }
  const host = parseRelayHostname(url)
  return host != null && isNostrArchivesBrandedHost(host)
}

export type RelayIconLucideFallback = 'search' | 'home'

function parseRelayHostname(url: string): string | undefined {
  const raw = (normalizeUrl(url) || url).trim()
  const forParse = raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
  try {
    return new URL(forParse).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

const MONERO_NOSTR_RELAY_HOSTS = new Set(
  MONERO_NOSTR_RELAY_URLS.map((relayUrl) => parseRelayHostname(relayUrl)).filter(
    (host): host is string => Boolean(host)
  )
)

/** Paid Monero Nostr relays (PMNR) and Nosmero tip-disclosure relay. */
export function isMoneroNostrBrandedRelayUrl(url: string | undefined): boolean {
  const host = parseRelayHostname(url ?? '')
  return host != null && isMoneroNostrBrandedHost(host)
}

/**
 * Static icon URL for NIP-05 domains and other site hostnames where `/favicon.ico` is wrong or missing.
 * Used by {@link Favicon} and {@link getRelayIconOverrideSrc}.
 */
export function getDomainIconOverrideSrc(domain: string | undefined): string | undefined {
  const host = domain ? normalizeFaviconDomain(domain) : undefined
  if (!host) return undefined
  if (isSovbitBrandedHost(host)) return SOVBIT_HOST_ICON_SRC
  if (isNostrArchivesBrandedHost(host)) return NOSTRARCHIVES_SITE_ICON_SRC
  if (isNostrLandBrandedHost(host)) return NOSTR_LAND_ICON_SRC
  if (isMoneroNostrBrandedHost(host)) return NEROST_RELAY_ICON_SRC
  return undefined
}

/**
 * Static icon URL for relays where NIP-11 is missing or we want a consistent mark (tab favicon).
 * Checked before NIP-11 `icon` in {@link RelayIcon}.
 */
export function getRelayIconOverrideSrc(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (isNostrArchivesBrandedRelayUrl(url)) {
    return NOSTRARCHIVES_SITE_ICON_SRC
  }
  const host = parseRelayHostname(url)
  return host ? getDomainIconOverrideSrc(host) : undefined
}

/** Loopback dev/cache relays (localhost, 127.0.0.1, ::1) — not broader LAN ranges. */
export function isLoopbackRelayUrl(url: string | undefined): boolean {
  const host = parseRelayHostname(url ?? '')
  if (!host) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * Lucide icon for relays that should not use NIP-11 / favicon (shown in {@link RelayIcon}).
 * Takes precedence over {@link getRelayIconOverrideSrc} and NIP-11 `icon`.
 */
export function getRelayIconLucideFallback(url: string | undefined): RelayIconLucideFallback | undefined {
  const host = parseRelayHostname(url ?? '')
  if (!host) return undefined
  if (host === 'search.nos.today') return 'search'
  if (isLoopbackRelayUrl(url)) return 'home'
  return undefined
}

/**
 * Unicode fallback when NIP-11 / favicon is missing or failed to load (shown in {@link RelayIcon}).
 * Sovbit hosts use {@link getRelayIconOverrideSrc} favicons instead; purplepag uses the purple circle.
 */
export function getRelayIconFallbackGlyph(url: string | undefined): string | undefined {
  if (getRelayIconLucideFallback(url)) return undefined
  const host = parseRelayHostname(url ?? '')
  if (!host) return undefined
  if (host === 'purplepag.es') return '🟣'
  return undefined
}

/** FNV-1a-ish fingerprint → HSL for a per-relay fallback swatch (no network). */
export function relayUrlFingerprintColors(url: string | undefined): {
  background: string
  color: string
} {
  const raw = url ?? ''
  const s = ((normalizeUrl(raw) || raw || '?').trim().toLowerCase())
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const hue = h % 360
  return {
    background: `hsl(${hue} 50% 36%)`,
    color: `hsl(${hue} 35% 96%)`
  }
}
