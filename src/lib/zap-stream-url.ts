const ZAP_STREAM_HOSTS = new Set(['zap.stream', 'www.zap.stream'])

const NADDR_BODY_RE = /^[02-9ac-hj-np-z]+$/i

/**
 * If `raw` is a zap.stream watch URL whose path is a bare `naddr1…` pointer, return canonical `https://zap.stream/naddr1…`.
 * Rejects unknown hosts and paths that are not a single naddr segment.
 */
export function canonicalZapStreamWatchUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!ZAP_STREAM_HOSTS.has(u.hostname.toLowerCase())) return null
    const segments = u.pathname.split('/').filter(Boolean)
    if (segments.length !== 1) return null
    const seg = segments[0]!
    if (!seg.startsWith('naddr1')) return null
    const body = seg.slice('naddr1'.length)
    if (!body || !NADDR_BODY_RE.test(body)) return null
    return `https://zap.stream/${seg}${u.search}`
  } catch {
    return null
  }
}

export function isZapStreamWatchUrl(url: string): boolean {
  return canonicalZapStreamWatchUrl(url) != null
}

/** NIP-19 `naddr1…` path segment from a zap.stream watch URL (embed as kind 30311 / LiveEvent). */
export function naddrFromZapStreamWatchUrl(raw: string): string | null {
  const canon = canonicalZapStreamWatchUrl(raw)
  if (!canon) return null
  try {
    const seg = new URL(canon).pathname.split('/').filter(Boolean)[0]
    if (seg?.startsWith('naddr1')) return seg
    return null
  } catch {
    return null
  }
}
