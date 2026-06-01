import { cleanUrl } from '@/lib/url'

/** URLs the user chose to load this session (tap-to-reveal); survives Image remounts when feeds re-parse. */
const revealed = new Set<string>()

export function markMediaUrlRevealed(url: string): void {
  const key = cleanUrl(url.trim())
  if (key) revealed.add(key)
}

export function wasMediaUrlRevealed(url: string): boolean {
  const key = cleanUrl(url.trim())
  return key ? revealed.has(key) : false
}
