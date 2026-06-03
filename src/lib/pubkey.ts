import { LRUCache } from 'lru-cache'
import { sha256 } from '@noble/hashes/sha2'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'

/** 64-char lowercase hex for identicon math; hashes arbitrary strings (e.g. bad npub paste). */
function stableHexSeedForIdenticon(input: string): string {
  const t = input.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  const bytes = sha256(new TextEncoder().encode(t))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function formatPubkey(pubkey: string) {
  const npub = pubkeyToNpub(pubkey)
  if (npub) {
    return formatNpub(npub)
  }
  return pubkey.slice(0, 4) + '...' + pubkey.slice(-4)
}

export function formatNpub(npub: string, length = 12) {
  if (length < 12) {
    length = 12
  }

  if (length >= 63) {
    return npub
  }

  const prefixLength = Math.floor((length - 5) / 2) + 5
  const suffixLength = length - prefixLength
  return npub.slice(0, prefixLength) + '...' + npub.slice(-suffixLength)
}

export function formatUserId(userId: string) {
  if (userId.startsWith('npub1')) {
    return formatNpub(userId)
  }
  return formatPubkey(userId)
}

export function pubkeyToNpub(pubkey: string) {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

export function userIdToPubkey(userId: string) {
  /** NIP-21 `nostr:` URI — must strip before bech32 / hex branches (otherwise we miss `npub1` / hex). */
  const trimmed = userId.trim().replace(/^nostr:/i, '').trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'npub' && typeof data === 'string' && isValidPubkey(data)) {
        return data.toLowerCase()
      }
      if (type === 'nprofile' && data && typeof data.pubkey === 'string' && isValidPubkey(data.pubkey)) {
        return data.pubkey.toLowerCase()
      }
    } catch {
      // Wrong-length or bad-checksum bech32 — do not pass the literal npub string downstream as "hex pubkey"
      logger.debug('userIdToPubkey: nip19 decode failed', { len: trimmed.length, prefix: trimmed.slice(0, 12) })
    }
    return ''
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  return trimmed
}

/** Lowercase 64-char hex pubkeys for stable Maps, REQ filters, and tag comparison. */
export function normalizeHexPubkey(pubkey: string): string {
  const t = pubkey.trim()
  return /^[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : t
}

export function hexPubkeysEqual(a: string, b: string): boolean {
  if (a === b) return true
  const na = normalizeHexPubkey(a)
  const nb = normalizeHexPubkey(b)
  return (
    na.length === 64 &&
    nb.length === 64 &&
    /^[0-9a-f]{64}$/.test(na) &&
    na === nb
  )
}

export function isValidPubkey(pubkey: string) {
  return /^[0-9a-f]{64}$/i.test(pubkey)
}

/** Hex pubkey from a NIP-07 `getPublicKey()` result (hex or npub / nostr: URI). */
export function pubkeyFromNip07Extension(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const fromId = userIdToPubkey(trimmed)
  if (isValidPubkey(fromId)) return fromId.toLowerCase()
  if (isValidPubkey(trimmed)) return trimmed.toLowerCase()
  return null
}

/** Hex pubkey from pasted npub / nprofile / hex / `nostr:` URL (e.g. invite lists). */
export function inviteInputToHexPubkey(raw: string): string | null {
  const t = raw.trim().replace(/^nostr:/i, '').trim()
  if (!t) return null
  const pk = userIdToPubkey(t)
  return isValidPubkey(pk) ? pk.toLowerCase() : null
}

const pubkeyImageCache = new LRUCache<string, string>({ max: 1000 })

// Version identifier to force cache invalidation when algorithm changes
const CACHE_VERSION = 'v2'

export function generateImageByPubkey(pubkey: string): string {
  const seed = stableHexSeedForIdenticon(pubkey)
  const cacheKey = `${CACHE_VERSION}:${seed}`
  if (pubkeyImageCache.has(cacheKey)) {
    return pubkeyImageCache.get(cacheKey)!
  }

  const paddedPubkey = seed.padEnd(66, '0')
  /** XML/HTML id tokens must not contain `nevent1…` or other punctuation from pasted ids */
  const svgIdSafe = `g${seed.slice(0, 20)}`

  // Split into 3 parts for colors and the rest for control points
  const colors: string[] = []
  const controlPoints: string[] = []
  for (let i = 0; i < 11; i++) {
    const part = paddedPubkey.slice(i * 6, (i + 1) * 6)
    if (i < 3) {
      colors.push(`#${part}`)
    } else {
      controlPoints.push(part)
    }
  }

  // Generate SVG with multiple radial gradients
  const gradients = controlPoints
    .map((point, index) => {
      const cx = parseInt(point.slice(0, 2), 16) % 100
      const cy = parseInt(point.slice(2, 4), 16) % 100
      const r = (parseInt(point.slice(4, 6), 16) % 35) + 30
      const c = colors[index % (colors.length - 1)]

      return `
        <radialGradient id="grad${index}-${svgIdSafe}" cx="${cx}%" cy="${cy}%" r="${r}%">
          <stop offset="0%" style="stop-color:${c};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${c};stop-opacity:0" />
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#grad${index}-${svgIdSafe})" />
      `
    })
    .join('')

  const image = `
    <svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${colors[2]}" fill-opacity="0.3" />
      ${gradients}
    </svg>
  `
  const imageData = `data:image/svg+xml;base64,${btoa(image)}`

  pubkeyImageCache.set(cacheKey, imageData)

  return imageData
}
