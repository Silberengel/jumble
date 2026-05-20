const SATS_PER_BTC = 100_000_000

export function satsToBtc(sats: number): number {
  return Math.max(0, sats) / SATS_PER_BTC
}

export function satsToUsd(sats: number, btcUsd: number): number {
  return satsToBtc(sats) * btcUsd
}

/** Human-readable BTC equivalent (e.g. 0.0021 BTC). */
export function formatBtcFromSats(sats: number): string {
  const btc = satsToBtc(sats)
  if (btc === 0) return '0 BTC'
  const maxFrac = btc >= 1 ? 4 : btc >= 0.01 ? 6 : 8
  const num = btc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac
  })
  return `${num} BTC`
}

/** USD equivalent; returns null when no rate is available. */
export function formatUsdFromSats(sats: number, btcUsd: number | null): string | null {
  if (btcUsd == null || !Number.isFinite(btcUsd) || btcUsd <= 0) return null
  const usd = satsToUsd(sats, btcUsd)
  const maxFrac = usd >= 1 ? 2 : 4
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFrac
  }).format(usd)
}
