import { LRUCache } from 'lru-cache'

/** Icon URLs that already failed to load — skip repeat network requests. */
const FAILED_FAVICON_URLS = new LRUCache<string, true>({ max: 512 })

export function normalizeFaviconDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

export function isFaviconLoadFailed(iconSrc: string): boolean {
  const key = iconSrc.trim()
  if (!key) return true
  return FAILED_FAVICON_URLS.has(key)
}

export function markFaviconLoadFailed(iconSrc: string): void {
  const key = iconSrc.trim()
  if (!key) return
  FAILED_FAVICON_URLS.set(key, true)
}
