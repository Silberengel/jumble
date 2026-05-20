import { TProfile } from '@/types'
import { Invoice } from '@getalby/lightning-tools'
import { isEmail } from './utils'

export function getAmountFromInvoice(invoice: string): number {
  const _invoice = new Invoice({ pr: invoice }) // TODO: need to validate
  return _invoice.satoshi
}

export function formatAmount(amount: number) {
  if (amount < 1000) return amount
  if (amount < 1000000) return `${Math.round(amount / 100) / 10}k`
  return `${Math.round(amount / 100000) / 10}M`
}

const SAT_GROUP_SEPARATOR = '\u2009'

/** Max sats digits in the zap amount field (9 999 999). */
export const MAX_ZAP_SATS = 9_999_999

/** Leading digit group + BTC hint styling above this amount (exclusive). */
export const ZAP_SATS_HIGHLIGHT_ABOVE = 999_999

/** Group sats in threes with a thin space (e.g. 210 000). */
export function formatSatsGrouped(amount: number): string {
  const n = clampZapSats(amount)
  return n.toLocaleString('en-US').replace(/,/g, SAT_GROUP_SEPARATOR)
}

export function clampZapSats(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0
  return Math.min(MAX_ZAP_SATS, Math.floor(amount))
}

/** True when amount is above 999 999 sats (≥ 1 000 000). */
export function shouldHighlightLeadingSatsGroups(amount: number): boolean {
  return clampZapSats(amount) > ZAP_SATS_HIGHLIGHT_ABOVE
}

/** Digit groups for display (e.g. ["210", "000"]). */
export function splitSatsGroupedParts(amount: number): string[] {
  const formatted = formatSatsGrouped(amount)
  if (!formatted) return ['0']
  return formatted.split(SAT_GROUP_SEPARATOR)
}

/** Parse user input that may contain digit grouping spaces. */
export function parseGroupedIntegerInput(raw: string): number {
  const digits = raw.replace(/\D/g, '').slice(0, 7)
  if (digits === '') return 0
  const num = parseInt(digits, 10)
  return Number.isFinite(num) ? clampZapSats(num) : 0
}

export function getLightningAddressFromProfile(profile: TProfile) {
  if (profile.lightningAddress?.trim()) return profile.lightningAddress.trim()
  if (profile.lightningAddressList?.length) {
    const first = profile.lightningAddressList.find((a) => a?.trim())
    if (first) return first.trim()
  }

  // Some clients have incorrectly filled in the positions for lud06 and lud16
  const { lud16: a, lud06: b } = profile
  let lud16: string | undefined
  let lud06: string | undefined
  if (a && isEmail(a)) {
    lud16 = a
  } else if (b && isEmail(b)) {
    lud16 = b
  } else if (a?.trim() && a.includes('.')) {
    lud16 = a.trim()
  } else if (b && b.startsWith('lnurl')) {
    lud06 = b
  } else if (a && a.startsWith('lnurl')) {
    lud06 = a
  }

  return lud16 || lud06 || undefined
}
