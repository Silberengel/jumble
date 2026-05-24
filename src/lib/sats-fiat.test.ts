import { describe, expect, it } from 'vitest'
import {
  formatBtcFromSats,
  formatUsdFromSats,
  formatXmrFromSats,
  formatSatsEquivalentsParts,
  satsToBtc,
  satsToUsd,
  satsToXmr
} from './sats-fiat'

describe('sats-fiat', () => {
  it('converts sats to btc', () => {
    expect(satsToBtc(100_000_000)).toBe(1)
    expect(satsToBtc(210_000)).toBe(0.0021)
  })

  it('formats btc from sats', () => {
    expect(formatBtcFromSats(0)).toBe('0 BTC')
    expect(formatBtcFromSats(210_000)).toContain('BTC')
    expect(formatBtcFromSats(210_000)).toMatch(/0\.0021|0,0021/)
  })

  it('formats usd when rate is known', () => {
    expect(formatUsdFromSats(210_000, null)).toBeNull()
    const usd = formatUsdFromSats(100_000_000, 100_000)
    expect(usd).toMatch(/\$|USD/)
    expect(satsToUsd(100_000_000, 100_000)).toBe(100_000)
  })

  it('formats xmr from sats using btc and xmr usd rates', () => {
    expect(formatXmrFromSats(100_000_000, 100_000, null)).toBeNull()
    expect(formatXmrFromSats(100_000_000, 100_000, 200)).toContain('XMR')
    expect(satsToXmr(100_000_000, 100_000, 200)).toBe(500)
  })

  it('builds equivalent parts in usd btc xmr order', () => {
    const parts = formatSatsEquivalentsParts(21_000, 100_000, 200)
    expect(parts.btc).toContain('BTC')
    expect(parts.usd).toMatch(/\$|USD/)
    expect(parts.xmr).toContain('XMR')
  })
})
