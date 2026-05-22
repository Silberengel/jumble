import { LRUCache } from 'lru-cache'

/** Domains whose `https://{host}/favicon.ico` already failed — skip repeat network requests. */
const FAILED_FAVICON_DOMAINS = new LRUCache<string, true>({ max: 512 })

export function normalizeFaviconDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

export function isFaviconLoadFailed(domain: string): boolean {
  const key = normalizeFaviconDomain(domain)
  if (!key) return true
  return FAILED_FAVICON_DOMAINS.has(key)
}

export function markFaviconLoadFailed(domain: string): void {
  const key = normalizeFaviconDomain(domain)
  if (!key) return
  FAILED_FAVICON_DOMAINS.set(key, true)
}
