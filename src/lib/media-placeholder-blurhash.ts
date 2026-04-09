import { isBlurhashValid } from 'blurhash'

/**
 * Stable, varied BlurHash strings for lazy media (no NIP-94 blurHash).
 *
 * Earlier we used a small set from the BlurHash reference corpus; several of those decode
 * to very high average luminance (~0.7–0.85 on a 0–1 scale), so at 32×32 scaled up they
 * read as “empty white” boxes — especially next to real colorful hashes from imeta.
 *
 * This list mixes medium-luma reference hashes with encodings of saturated solids and
 * gradients (all validated). URL hashing still picks deterministically among them.
 */
const PLACEHOLDER_BLURHASHES = [
  'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
  'LdHxL5Rk^6#M@-5c,1J5@[or[Q6.',
  'LGF?UQ%2Tw[w]~RBVZRi};RPxuwH',
  'U18:W20c[[Os-ZNrjta}fQfQfQfQ-ZNrjta}',
  'U1Ed6O05}-I[}rEhoKazfQfQfQfQ}rEhoKaz',
  'U32?$,uWklo{kWk9fjfjfQfQfQfQkWk9fjfj',
  'U08DbR00omx9?IRhfSjsfQfQfQfQ?IRhfSjs',
  'U56aYxGKfmkEogbIfRfRfQfQfQfQogbIfRfR',
  'L19GOz-afQ-a-aj]fQj]fQfQfQfQ',
  'L03eAJuifQuiuikCfQkCfQfQfQfQ',
  'L1D*FJ}rfQ}r}roLfQoLfQfQfQfQ'
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
