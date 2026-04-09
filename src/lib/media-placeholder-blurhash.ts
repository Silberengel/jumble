import { isBlurhashValid } from 'blurhash'

/**
 * Stable, varied BlurHash strings for lazy media (no imeta). Picked from the reference
 * encoder corpus; each validates with {@link isBlurhashValid}.
 */
const PLACEHOLDER_BLURHASHES = [
  'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
  'LjIY%^?bH?xu_4t8V_NHxZxbx]ae',
  'L6PZfSjE.Adjc0j]WCWVH?j?bHwc',
  'LKO2?U%2Tw[w]~RBVZRi};RPxuwH',
  'LdHxL5Rk^6#M@-5c,1J5@[or[Q6.',
  'LGF?UQ%2Tw[w]~RBVZRi};RPxuwH',
  'L6PZ0Si_.AyE_3t7t7R**0o#D%IU'
].filter((h) => isBlurhashValid(h).result)

function fallbackHashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Deterministic placeholder blurhash from media URL (stable across re-renders). */
export function blurHashPlaceholderForMediaUrl(url: string): string {
  if (PLACEHOLDER_BLURHASHES.length === 0) {
    return 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
  }
  const i = fallbackHashString(url.trim()) % PLACEHOLDER_BLURHASHES.length
  return PLACEHOLDER_BLURHASHES[i]!
}

/** Use NIP-94 blurHash when valid; otherwise URL-derived placeholder. */
export function resolveMediaBlurPlaceholder(url: string, blurHash?: string): string {
  if (blurHash?.trim()) {
    const v = isBlurhashValid(blurHash.trim())
    if (v.result) return blurHash.trim()
  }
  return blurHashPlaceholderForMediaUrl(url)
}
