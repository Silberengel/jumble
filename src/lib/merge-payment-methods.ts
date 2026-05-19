import { getPaymentInfoFromEvent } from '@/lib/event-metadata'
import { buildPaytoUri, getCanonicalPaytoType, getPaytoEditorTypeLabel, getPaytoTypeInfo } from '@/lib/payto'
import type { TProfile } from '@/types'

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
  profile: TProfile | null
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
      if (normType === 'lightning') {
        existing.authority = resolveLightningAuthority(existing.authority, authority.trim())
        existing.payto = buildPaytoUri(normType, existing.authority)
      }
      return
    }
    const trimmedAuthority = authority.trim()
    const resolvedAuthority =
      normType === 'lightning' ? resolveLightningAuthority(trimmedAuthority) : trimmedAuthority
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

  return out
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

/** Payment targets that differ from the lightning address used for zapping. */
export function getAlternativePaymentMethods(
  methods: MergedPaymentMethod[],
  zapLightningAddress: string | undefined
): MergedPaymentMethod[] {
  const zapNorm = zapLightningAddress?.trim()
    ? normalizePaymentAuthority('lightning', zapLightningAddress)
    : null
  if (!zapNorm) return methods
  return methods.filter((m) => normalizePaymentAuthority(m.type, m.authority) !== zapNorm)
}
