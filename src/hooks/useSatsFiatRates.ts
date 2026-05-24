import { fetchBtcUsdRate } from '@/lib/btc-usd-rate'
import { fetchXmrUsdRate } from '@/lib/xmr-usd-rate'
import { useEffect, useState } from 'react'

export type SatsFiatRates = {
  btcUsd: number | null
  xmrUsd: number | null
}

/** BTC/USD and XMR/USD spot rates for sats amount hints (null while loading or on failure). */
export function useSatsFiatRates(): SatsFiatRates {
  const [rates, setRates] = useState<SatsFiatRates>({ btcUsd: null, xmrUsd: null })

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchBtcUsdRate(), fetchXmrUsdRate()]).then(([btcUsd, xmrUsd]) => {
      if (!cancelled) setRates({ btcUsd, xmrUsd })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return rates
}
