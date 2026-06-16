import { cleanUrl } from '@/lib/url'

/** URLs the user chose to load this session (tap-to-reveal); survives Image remounts when feeds re-parse. */
const revealed = new Set<string>()
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function markMediaUrlRevealed(url: string): void {
  markMediaUrlsRevealed([url])
}

/** Canonical imeta URL plus playable mirrors (e.g. r2a) share one reveal. */
export function markMediaUrlsRevealed(urls: readonly string[]): void {
  let changed = false
  for (const raw of urls) {
    const key = cleanUrl(raw.trim())
    if (!key || revealed.has(key)) continue
    revealed.add(key)
    changed = true
  }
  if (changed) notifyListeners()
}

export function wasMediaUrlRevealed(url: string): boolean {
  const key = cleanUrl(url.trim())
  return key ? revealed.has(key) : false
}

/** Live updates when another Image / note panel reveals the same URL. */
export function subscribeRevealedMedia(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
