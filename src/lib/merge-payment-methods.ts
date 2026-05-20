import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import {
  buildPaytoUri,
  getCanonicalPaytoType,
  getPaytoEditorTypeLabel,
  getPaytoTypeInfo,
  isLightningPaytoType,
  isZappableLightningPaytoType
} from '@/lib/payto'
import { normalizePaypalAuthority } from '@/lib/payto-paypal-url'
import type { TProfile } from '@/types'
import { kinds, type Event } from 'nostr-tools'

export type MergedPaymentMethod = {
  type: string
  authority: string
  payto?: string
  displayType: string
  currency?: string
  minAmount?: number
  maxAmount?: number
}

export type PaymentMethodGroup = {
  displayType: string
  methods: MergedPaymentMethod[]
  /** Zap dialog: emphasize on-chain Bitcoin when tip is ≥ 10k sats. */
  highlighted?: boolean
}

export type ZapDialogAlternativePayments = {
  groups: PaymentMethodGroup[]
  /** Show banner when on-chain Bitcoin targets are listed (≥ 10k sats). */
  showBitcoinOnChainHint: boolean
}

/** Normalize lightning/LUD-16 authority to a canonical form for deduplication. */
export function normalizeLightningAuthority(authority: string): string {
  const s = authority.trim().toLowerCase()
  if (!s) return s
  if (s.includes('@')) return s
  const firstDot = s.indexOf('.')
  if (firstDot > 0) return s.slice(0, firstDot) + '@' + s.slice(firstDot + 1)
  return s
}

export function normalizePaymentAuthority(type: string, authority: string): string {
  const t = type.toLowerCase()
  if (t === 'lightning' && authority) return normalizeLightningAuthority(authority)
  return authority.trim().toLowerCase()
}

function preferCanonicalLightningAuthority(a: string, b: string): string {
  const hasAt = (s: string) => s.trim().includes('@')
  if (hasAt(a) && !hasAt(b)) return a
  if (hasAt(b) && !hasAt(a)) return b
  return a
}

/** Canonical LUD-16 authority (user@domain) for display and payto:// URIs. */
function resolveLightningAuthority(a: string, b?: string): string {
  const preferred = b !== undefined ? preferCanonicalLightningAuthority(a, b) : a
  return normalizeLightningAuthority(preferred) || preferred.trim()
}

/** Below this zap size, on-chain Bitcoin payto targets are hidden in the zap dialog. */
export const ZAP_HIDE_BITCOIN_ALTS_MAX_SATS = 10_000

/** On-chain Bitcoin family (not Lightning / Liquid layer types). */
export function isBitcoinCategoryPaytoType(type: string): boolean {
  return getPaytoTypeInfo(getCanonicalPaytoType(type))?.category === 'bitcoin'
}

/** Sort key for zap dialog “other payment” groups (lower = higher in list). */
function zapAlternativeGroupSortRank(group: PaymentMethodGroup): number {
  const types = group.methods.map((m) => getCanonicalPaytoType(m.type))
  if (types.some((t) => isBitcoinCategoryPaytoType(t))) return -1000
  if (types.some((t) => getPaytoTypeInfo(t)?.category === 'bitcoin-layer' || t === 'liquid' || t === 'lbtc')) {
    return 0
  }
  if (types.some((t) => t === 'monero')) return 1
  if (types.some((t) => t === 'usdt')) return 2
  if (types.some((t) => t === 'usdc')) return 3
  return 10
}

/** Filter, order, and annotate payto groups for the zap dialog “other payment methods” block. */
export function prepareZapDialogAlternativePayments(
  groups: PaymentMethodGroup[],
  zapSats: number
): ZapDialogAlternativePayments {
  const showBitcoin = zapSats >= ZAP_HIDE_BITCOIN_ALTS_MAX_SATS

  const filtered = showBitcoin
    ? groups
    : groups
        .map((group) => ({
          ...group,
          methods: group.methods.filter((m) => !isBitcoinCategoryPaytoType(m.type))
        }))
        .filter((group) => group.methods.length > 0)

  const prepared = filtered
    .map((group) => ({
      ...group,
      highlighted:
        showBitcoin && group.methods.some((m) => isBitcoinCategoryPaytoType(m.type))
    }))
    .sort((a, b) => zapAlternativeGroupSortRank(a) - zapAlternativeGroupSortRank(b))

  return {
    groups: prepared,
    showBitcoinOnChainHint: showBitcoin && prepared.some((g) => g.highlighted)
  }
}

/** @deprecated Use {@link prepareZapDialogAlternativePayments} */
export function filterPaymentMethodGroupsForZapAmount(
  groups: PaymentMethodGroup[],
  zapSats: number
): PaymentMethodGroup[] {
  return prepareZapDialogAlternativePayments(groups, zapSats).groups
}

/** Bitcoin-layer first, then on-chain Bitcoin family, then everything else. */
export function paytoPaymentSortRank(type: string): number {
  const category = getPaytoTypeInfo(type)?.category
  if (category === 'bitcoin-layer') return 0
  if (category === 'bitcoin') return 1
  return 2
}

/** Merge payment methods from kind 10133 and profile (kind 0: JSON + tags), normalized and deduplicated. */
export function mergePaymentMethods(
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null,
  profile: TProfile | null,
  profileEvent?: Event | null
): MergedPaymentMethod[] {
  const seen = new Map<string, MergedPaymentMethod>()
  const out: MergedPaymentMethod[] = []

  const add = (
    type: string,
    authority: string,
    payto?: string,
    displayType?: string,
    extra?: { currency?: string; minAmount?: number; maxAmount?: number }
  ) => {
    if (!authority?.trim()) return
    const normType = getCanonicalPaytoType(type)
    const key = `${normType}:${normalizePaymentAuthority(normType, authority)}`
    const existing = seen.get(key)
    if (existing) {
      if (isLightningPaytoType(normType)) {
        existing.authority = resolveLightningAuthority(existing.authority, authority.trim())
        existing.payto = buildPaytoUri(normType, existing.authority)
      }
      return
    }
    const trimmedAuthority = authority.trim()
    const resolvedAuthority =
      isLightningPaytoType(normType)
        ? resolveLightningAuthority(trimmedAuthority)
        : normType === 'paypal'
          ? normalizePaypalAuthority(trimmedAuthority)
          : trimmedAuthority
    const entry: MergedPaymentMethod = {
      type: normType,
      authority: resolvedAuthority,
      payto: payto || (normType && resolvedAuthority ? buildPaytoUri(normType, resolvedAuthority) : undefined),
      displayType: displayType || getPaytoEditorTypeLabel(normType),
      ...extra
    }
    seen.set(key, entry)
    out.push(entry)
  }

  const fromProfile = profile?.lightningAddressList?.length
    ? profile.lightningAddressList
    : profile?.lightningAddress
      ? [profile.lightningAddress]
      : []
  fromProfile.forEach((addr) => {
    if (addr) add('lightning', addr, `payto://lightning/${addr}`, 'Lightning Network')
  })

  profile?.wWalletTags?.forEach((w) => {
    const net = w.network.toLowerCase()
    if (net === 'lightning') return
    const addr = w.address?.trim()
    if (!addr) return
    const cur = (w.currency || '').trim().toLowerCase()

    if (net === 'bitcoin') {
      add('bitcoin', addr, buildPaytoUri('bitcoin', addr), 'Bitcoin', { currency: w.currency })
      return
    }

    if (cur === 'usdt' || cur === 'usd₮' || cur === 'tether' || net === 'usdt') {
      add('usdt', addr, buildPaytoUri('usdt', addr), 'Tether (USDT)', { currency: w.currency || 'USDT' })
      return
    }

    if (net === 'liquid') {
      if (cur === 'lbtc' || cur === 'l-btc' || cur === 'liquid btc') {
        add('lbtc', addr, buildPaytoUri('lbtc', addr), 'Liquid Bitcoin (LBTC)', { currency: w.currency })
      } else {
        add('liquid', addr, buildPaytoUri('liquid', addr), cur ? `Liquid (${w.currency})` : 'Liquid', {
          currency: w.currency
        })
      }
      return
    }

    if (cur === 'lbtc' || cur === 'l-btc') {
      add('lbtc', addr, buildPaytoUri('lbtc', addr), 'Liquid Bitcoin (LBTC)', { currency: w.currency })
    }
  })

  if (paymentInfo?.methods?.length) {
    paymentInfo.methods.forEach((m) => {
      const authority = m.authority || m.address || ''
      add(
        (m.type || 'lightning').toLowerCase(),
        authority,
        m.payto,
        m.displayType,
        { currency: m.currency, minAmount: m.minAmount, maxAmount: m.maxAmount }
      )
    })
  } else if (paymentInfo?.payto) {
    const type = (paymentInfo.type || 'lightning').toLowerCase()
    const authority = paymentInfo.authority || paymentInfo.payto.replace(/^payto:\/\/[^/]+\//, '') || ''
    add(type, authority, paymentInfo.payto, type === 'lightning' ? 'Lightning Network' : paymentInfo.type || 'Payment')
  }

  if (profileEvent?.kind === kinds.Metadata) {
    for (const tag of profileEvent.tags) {
      if (tag[0] === 'payto' && tag[1] && tag[2]) {
        const type = String(tag[1]).toLowerCase()
        add(type, String(tag[2]), buildPaytoUri(getCanonicalPaytoType(type), String(tag[2])))
      }
    }
  }

  return out
}

/** True when the recipient has any payto / Lightning target (kind 0 or 10133). */
export function recipientHasAnyPaymentOptions(
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null,
  profile: TProfile | null,
  profileEvent?: Event | null
): boolean {
  return mergePaymentMethods(paymentInfo, profile, profileEvent).length > 0
}

export function sortMergedPaymentMethods(methods: MergedPaymentMethod[]): MergedPaymentMethod[] {
  return [...methods].sort((a, b) => paytoPaymentSortRank(a.type) - paytoPaymentSortRank(b.type))
}

/** Group payment methods by displayType (same headings as profile payment section). */
export function groupPaymentMethodsByDisplayType(methods: MergedPaymentMethod[]): PaymentMethodGroup[] {
  const groups = new Map<string, MergedPaymentMethod[]>()
  for (const method of methods) {
    const key = method.displayType || method.type
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(method)
  }
  const order = Array.from(groups.keys()).sort((a, b) => {
    const typeA = groups.get(a)?.[0]?.type ?? ''
    const typeB = groups.get(b)?.[0]?.type ?? ''
    return paytoPaymentSortRank(typeA) - paytoPaymentSortRank(typeB)
  })
  return order.map((key) => ({ displayType: key, methods: groups.get(key) ?? [] }))
}

/**
 * Ordered Lightning targets for zaps: kind 0 `lud16` tags, then `w` (network lightning),
 * then kind 10133 lightning methods. Optional `preferredAddress` is moved to the front.
 */
export function buildOrderedZapLightningAddresses(opts: {
  profileEvent?: Event | null
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
  preferredAddress?: string | null
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (raw: string | undefined) => {
    if (!raw?.trim()) return
    const resolved = resolveLightningAuthority(raw.trim())
    const key = normalizePaymentAuthority('lightning', resolved)
    if (seen.has(key)) return
    seen.add(key)
    out.push(resolved)
  }

  const ev = opts.profileEvent
  const profile = ev?.kind === kinds.Metadata ? getProfileFromEvent(ev) : null
  if (ev?.kind === kinds.Metadata) {
    for (const tag of ev.tags) {
      if (tag[0] === 'lud16' && tag[1]) add(tag[1])
      if (tag[0] === 'lud06' && tag[1]) add(tag[1])
    }
    for (const tag of ev.tags) {
      if (tag[0] !== 'w' || !tag[1] || !tag[2]) continue
      if (tag[3] && String(tag[3]).toLowerCase() === 'lightning') {
        add(tag[2])
      } else if (!tag[3] && String(tag[1]).toLowerCase() === 'lightning') {
        add(tag[2])
      }
    }
  }

  const paymentMethods = mergePaymentMethods(opts.paymentInfo, profile, ev)
  for (const m of paymentMethods) {
    if (isZappableLightningPaytoType(m.type)) add(m.authority)
  }

  return prioritizeZapLightningAddress(out, opts.preferredAddress ?? undefined)
}

/** Move `preferred` to the front when present; append if not already listed. */
export function prioritizeZapLightningAddress(candidates: string[], preferred?: string): string[] {
  if (!preferred?.trim()) return candidates
  const norm = normalizePaymentAuthority('lightning', preferred)
  const idx = candidates.findIndex((c) => normalizePaymentAuthority('lightning', c) === norm)
  if (idx === -1) {
    return [resolveLightningAuthority(preferred.trim()), ...candidates]
  }
  const rest = candidates.filter((_, i) => i !== idx)
  return [candidates[idx], ...rest]
}

/** Non-zap payto targets for zap dialog “other payment methods” (LUD-16 uses the Lightning selector). */
export function getAlternativePaymentMethods(methods: MergedPaymentMethod[]): MergedPaymentMethod[] {
  return methods.filter((m) => !isZappableLightningPaytoType(m.type))
}
