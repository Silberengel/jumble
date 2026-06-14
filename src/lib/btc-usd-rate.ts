const CACHE_MS = 5 * 60 * 1000

let cache: { usd: number; at: number } | null = null
let inFlight: Promise<number | null> | null = null

/** Cached BTC/USD if {@link fetchBtcUsdRate} has run recently (sync feed filters). */
export function getCachedBtcUsdRate(): number | null {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.usd
  return null
}

/** Latest BTC/USD spot price (cached ~5 min). */
export async function fetchBtcUsdRate(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.usd
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
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
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
