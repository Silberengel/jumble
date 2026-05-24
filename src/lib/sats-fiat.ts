const SATS_PER_BTC = 100_000_000

export function satsToBtc(sats: number): number {
  return Math.max(0, sats) / SATS_PER_BTC
}

export function satsToUsd(sats: number, btcUsd: number): number {
  return satsToBtc(sats) * btcUsd
}

export function satsToXmr(sats: number, btcUsd: number, xmrUsd: number): number {
  if (xmrUsd <= 0) return 0
  return satsToUsd(sats, btcUsd) / xmrUsd
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

/** Human-readable XMR equivalent via BTC/USD and XMR/USD spot rates. */
export function formatXmrFromSats(
  sats: number,
  btcUsd: number | null,
  xmrUsd: number | null
): string | null {
  if (btcUsd == null || !Number.isFinite(btcUsd) || btcUsd <= 0) return null
  if (xmrUsd == null || !Number.isFinite(xmrUsd) || xmrUsd <= 0) return null
  const xmr = satsToXmr(sats, btcUsd, xmrUsd)
  if (xmr === 0) return '0 XMR'
  const maxFrac = xmr >= 1 ? 4 : xmr >= 0.01 ? 6 : 8
  const num = xmr.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac
  })
  return `${num} XMR`
}

export type SatsEquivalentsParts = {
  usd: string | null
  btc: string
  xmr: string | null
}

export function formatSatsEquivalentsParts(
  sats: number,
  btcUsd: number | null,
  xmrUsd: number | null
): SatsEquivalentsParts {
  return {
    usd: formatUsdFromSats(sats, btcUsd),
    btc: formatBtcFromSats(sats),
    xmr: formatXmrFromSats(sats, btcUsd, xmrUsd)
  }
}
