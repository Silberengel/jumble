import { NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'

/**
 * Site favicon for nostr.sovbit (same as the browser tab icon on `/invoices` and the rest of the host).
 * @see https://nostr.sovbit.host/invoices
 */
export const NOSTR_SOVBIT_ICON_SRC = 'https://nostr.sovbit.host/favicon.ico'

/**
 * Free relay slice — distinct branding from paid nostr.sovbit.
 * @see https://freelay.sovbit.host/
 */
export const FREELAY_SOVBIT_ICON_SRC = 'https://freelay.sovbit.host/favicon.ico'

/**
 * Nostr Archives front-site favicon for trending shards, search relay, and related hosts.
 * @see https://nostrarchives.com/
 */
export const NOSTRARCHIVES_SITE_ICON_SRC = 'https://nostrarchives.com/favicon.ico'

/** Same branding as Wisp trending — nostrarchives.com favicon in {@link RelayIcon}. */
export function isNostrArchivesBrandedRelayUrl(url: string | undefined): boolean {
  if (!url) return false
  if (isWispTrendingNotesRelayUrl(url)) return true
  const norm = (normalizeUrl(url) || url).trim().toLowerCase()
  if (norm === (normalizeUrl(NOSTR_ARCHIVES_SEARCH_RELAY_URL) || NOSTR_ARCHIVES_SEARCH_RELAY_URL).toLowerCase()) {
    return true
  }
  const host = parseRelayHostname(url)
  return (
    host === 'feeds.nostrarchives.com' ||
    host === 'nostrarchives.com' ||
    host === 'search.nostrarchives.com'
  )
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

/**
 * Static icon URL for relays where NIP-11 is missing or we want a consistent mark (tab favicon).
 * Checked before NIP-11 `icon` in {@link RelayIcon}.
 */
export function getRelayIconOverrideSrc(url: string | undefined): string | undefined {
  if (!url) return undefined
  const host = parseRelayHostname(url)
  if (!host) return undefined
  if (host === 'nostr.sovbit.host') {
    return NOSTR_SOVBIT_ICON_SRC
  }
  if (host === 'freelay.sovbit.host') {
    return FREELAY_SOVBIT_ICON_SRC
  }
  if (isNostrArchivesBrandedRelayUrl(url)) {
    return NOSTRARCHIVES_SITE_ICON_SRC
  }
  return undefined
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
