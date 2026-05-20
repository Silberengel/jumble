import { fetchBtcUsdRate } from '@/lib/btc-usd-rate'
import { useEffect, useState } from 'react'

/** BTC/USD spot for zap amount hints (null while loading or if fetch failed). */
export function useBtcUsdRate() {
  const [btcUsd, setBtcUsd] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBtcUsdRate().then((rate) => {
      if (!cancelled) setBtcUsd(rate)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return btcUsd
}
