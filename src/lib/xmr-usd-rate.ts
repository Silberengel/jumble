const CACHE_MS = 5 * 60 * 1000

let cache: { usd: number; at: number } | null = null

/** Cached XMR/USD if {@link fetchXmrUsdRate} has run recently (sync feed filters). */
export function getCachedXmrUsdRate(): number | null {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.usd
  return null
}

/** Latest XMR/USD spot price (cached ~5 min). */
export async function fetchXmrUsdRate(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.usd
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd'
    )
    if (!res.ok) return cache?.usd ?? null
    const data = (await res.json()) as { monero?: { usd?: number } }
    const usd = Number(data.monero?.usd)
    if (!Number.isFinite(usd) || usd <= 0) return cache?.usd ?? null
    cache = { usd, at: Date.now() }
    return usd
  } catch {
    return cache?.usd ?? null
  }
}
