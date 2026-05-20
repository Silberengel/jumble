const CACHE_MS = 5 * 60 * 1000

let cache: { usd: number; at: number } | null = null

/** Latest BTC/USD spot price (cached ~5 min). */
export async function fetchBtcUsdRate(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.usd
  }
  try {
    const res = await fetch('https://mempool.space/api/v1/prices')
    if (!res.ok) return cache?.usd ?? null
    const data = (await res.json()) as { USD?: number }
    const usd = Number(data.USD)
    if (!Number.isFinite(usd) || usd <= 0) return cache?.usd ?? null
    cache = { usd, at: Date.now() }
    return usd
  } catch {
    return cache?.usd ?? null
  }
}
