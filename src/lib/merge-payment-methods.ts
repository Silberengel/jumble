import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import {
  buildPaytoUri,
  getCanonicalPaytoType,
  getPaytoEditorTypeLabel,
  getPaytoTypeInfo,
  isKnownPaytoType,
  isLightningPaytoType,
  isZappableLightningPaytoType
} from '@/lib/payto'
import { extractKind0PaymentMethodsFromProfileJson } from '@/lib/payto-kind0-import'
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
  /** Position in the profile (kind 0) event, for within-category ordering. */
  profileOrder?: number
  /** Position in the payment (kind 10133) event, for within-category ordering. */
  paymentOrder?: number
}

type PaymentMethodInput = {
  type: string
  authority: string
  payto?: string
  displayType?: string
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

const LIGHTNING_NETWORK_LABEL = 'Lightning Network'

/** Map a kind 0 `w` tag to a payto-shaped row (tag order preserved by the caller). */
function paymentMethodInputFromWTag(tag: string[]): PaymentMethodInput | null {
  if (tag[0] !== 'w' || !tag[1] || !tag[2]) return null

  const addr = String(tag[2]).trim()
  if (!addr) return null

  let currency = String(tag[1]).trim()
  let network = tag[3] ? String(tag[3]).trim().toLowerCase() : ''

  if (!network && currency.toLowerCase() === 'lightning') {
    network = 'lightning'
    currency = ''
  }

  if (!network) return null

  const cur = currency.toLowerCase()
  const net = network.toLowerCase()

  if (net === 'lightning') {
    return { type: 'lightning', authority: addr, displayType: LIGHTNING_NETWORK_LABEL }
  }

  if (net === 'bitcoin') {
    return {
      type: 'bitcoin',
      authority: addr,
      payto: buildPaytoUri('bitcoin', addr),
      displayType: 'Bitcoin',
      currency: currency || undefined
    }
  }

  const netCanonical = getCanonicalPaytoType(net)
  if (
    isKnownPaytoType(netCanonical) &&
    !isLightningPaytoType(netCanonical) &&
    netCanonical !== 'bitcoin' &&
    netCanonical !== 'liquid' &&
    netCanonical !== 'lbtc' &&
    netCanonical !== 'usdt'
  ) {
    return {
      type: netCanonical,
      authority: addr,
      payto: buildPaytoUri(netCanonical, addr),
      displayType: getPaytoEditorTypeLabel(netCanonical),
      currency: currency || undefined
    }
  }

  if (cur === 'usdt' || cur === 'usd₮' || cur === 'tether' || net === 'usdt') {
    return {
      type: 'usdt',
      authority: addr,
      payto: buildPaytoUri('usdt', addr),
      displayType: 'Tether (USDT)',
      currency: currency || 'USDT'
    }
  }

  if (net === 'liquid') {
    if (cur === 'lbtc' || cur === 'l-btc' || cur === 'liquid btc') {
      return {
        type: 'lbtc',
        authority: addr,
        payto: buildPaytoUri('lbtc', addr),
        displayType: 'Liquid Bitcoin (LBTC)',
        currency: currency || undefined
      }
    }
    return {
      type: 'liquid',
      authority: addr,
      payto: buildPaytoUri('liquid', addr),
      displayType: cur ? `Liquid (${currency})` : 'Liquid',
      currency: currency || undefined
    }
  }

  if (cur === 'lbtc' || cur === 'l-btc') {
    return {
      type: 'lbtc',
      authority: addr,
      payto: buildPaytoUri('lbtc', addr),
      displayType: 'Liquid Bitcoin (LBTC)',
      currency: currency || undefined
    }
  }

  return null
}

/**
 * Payment targets from a kind 0 event in document order: tags top-to-bottom, then JSON content.
 */
export function extractProfileEventPaymentMethodsInOrder(
  profileEvent: Event | null | undefined
): PaymentMethodInput[] {
  if (!profileEvent || profileEvent.kind !== kinds.Metadata) return []

  const out: PaymentMethodInput[] = []

  for (const tag of profileEvent.tags) {
    const name = tag[0]
    if (name === 'lud16' && tag[1]) {
      out.push({
        type: 'lightning',
        authority: String(tag[1]),
        displayType: LIGHTNING_NETWORK_LABEL
      })
      continue
    }
    if (name === 'lud06' && tag[1]) {
      out.push({
        type: 'lightning',
        authority: String(tag[1]),
        displayType: LIGHTNING_NETWORK_LABEL
      })
      continue
    }
    if (name === 'w') {
      const row = paymentMethodInputFromWTag(tag)
      if (row) out.push(row)
      continue
    }
    if (name === 'payto' && tag[1] && tag[2]) {
      const type = String(tag[1]).toLowerCase()
      const authority = String(tag[2])
      out.push({
        type,
        authority,
        payto: buildPaytoUri(getCanonicalPaytoType(type), authority)
      })
    }
  }

  try {
    const profileJson = JSON.parse(profileEvent.content || '{}') as Record<string, unknown>
    const lud16 = profileJson.lud16
    if (typeof lud16 === 'string' && lud16.trim()) {
      out.push({
        type: 'lightning',
        authority: lud16.trim(),
        displayType: LIGHTNING_NETWORK_LABEL
      })
    }
    const lud06 = profileJson.lud06
    if (typeof lud06 === 'string' && lud06.trim()) {
      out.push({
        type: 'lightning',
        authority: lud06.trim(),
        displayType: LIGHTNING_NETWORK_LABEL
      })
    }
    for (const m of extractKind0PaymentMethodsFromProfileJson(profileJson)) {
      out.push({
        type: m.type,
        authority: m.authority,
        payto: m.payto,
        displayType: m.displayType
      })
    }
  } catch {
    /* ignore invalid kind 0 JSON */
  }

  return out
}

function paymentMethodInputKey(input: PaymentMethodInput): string {
  const normType = getCanonicalPaytoType(input.type)
  return `${normType}:${normalizePaymentAuthority(normType, input.authority)}`
}

/** Append inputs from `extra` that are not already in `primary` (same type + authority). */
function appendUniquePaymentInputs(
  primary: PaymentMethodInput[],
  extra: PaymentMethodInput[]
): PaymentMethodInput[] {
  const keys = new Set(primary.map(paymentMethodInputKey))
  const out = [...primary]
  for (const input of extra) {
    const key = paymentMethodInputKey(input)
    if (keys.has(key)) continue
    keys.add(key)
    out.push(input)
  }
  return out
}

/** Fallback when only parsed profile is available (no kind 0 event loaded). */
function extractParsedProfilePaymentMethodsInOrder(profile: TProfile | null): PaymentMethodInput[] {
  if (!profile) return []

  const out: PaymentMethodInput[] = []
  const lightningList = profile.lightningAddressList?.length
    ? profile.lightningAddressList
    : profile.lightningAddress
      ? [profile.lightningAddress]
      : []

  for (const addr of lightningList) {
    if (addr?.trim()) {
      out.push({
        type: 'lightning',
        authority: addr,
        displayType: LIGHTNING_NETWORK_LABEL
      })
    }
  }

  profile.wWalletTags?.forEach((w) => {
    const row = paymentMethodInputFromWTag(['w', w.currency, w.address, w.network])
    if (row) out.push(row)
  })

  return out
}

/**
 * Payment targets from kind 10133 in document order (payto tags, or JSON methods fallback).
 */
export function extractPaymentEventMethodsInOrder(
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
): PaymentMethodInput[] {
  if (!paymentInfo) return []

  if (paymentInfo.methods?.length) {
    return paymentInfo.methods.map((m) => {
      const type = (m.type || 'lightning').toLowerCase()
      const authority = m.authority || m.address || ''
      return {
        type,
        authority,
        payto: m.payto,
        displayType: m.displayType,
        currency: m.currency,
        minAmount: m.minAmount,
        maxAmount: m.maxAmount
      }
    })
  }

  if (paymentInfo.payto) {
    const type = (paymentInfo.type || 'lightning').toLowerCase()
    const authority =
      paymentInfo.authority || paymentInfo.payto.replace(/^payto:\/\/[^/]+\//, '') || ''
    return [
      {
        type,
        authority,
        payto: paymentInfo.payto,
        displayType:
          type === 'lightning' ? LIGHTNING_NETWORK_LABEL : paymentInfo.type || 'Payment'
      }
    ]
  }

  return []
}

function normalizePaymentMethodInput(input: PaymentMethodInput): MergedPaymentMethod | null {
  const authority = input.authority?.trim()
  if (!authority) return null

  const normType = getCanonicalPaytoType(input.type)
  const resolvedAuthority = isLightningPaytoType(normType)
    ? resolveLightningAuthority(authority)
    : normType === 'paypal'
      ? normalizePaypalAuthority(authority)
      : authority

  return {
    type: normType,
    authority: resolvedAuthority,
    payto:
      input.payto ||
      (normType && resolvedAuthority ? buildPaytoUri(normType, resolvedAuthority) : undefined),
    displayType: input.displayType || getPaytoEditorTypeLabel(normType),
    currency: input.currency,
    minAmount: input.minAmount,
    maxAmount: input.maxAmount
  }
}

function mergeOrderedPaymentMethodLists(
  profileInputs: PaymentMethodInput[],
  paymentInputs: PaymentMethodInput[]
): MergedPaymentMethod[] {
  const seen = new Map<string, MergedPaymentMethod>()
  const out: MergedPaymentMethod[] = []

  const ingest = (inputs: PaymentMethodInput[], source: 'profile' | 'payment') => {
    inputs.forEach((input, index) => {
      const normalized = normalizePaymentMethodInput(input)
      if (!normalized) return

      const key = `${normalized.type}:${normalizePaymentAuthority(normalized.type, normalized.authority)}`
      const existing = seen.get(key)
      if (existing) {
        if (isLightningPaytoType(normalized.type)) {
          existing.authority = resolveLightningAuthority(existing.authority, normalized.authority)
          existing.payto = buildPaytoUri(normalized.type, existing.authority)
        }
        return
      }

      const entry: MergedPaymentMethod = {
        ...normalized,
        ...(source === 'profile' ? { profileOrder: index } : { paymentOrder: index })
      }
      seen.set(key, entry)
      out.push(entry)
    })
  }

  ingest(profileInputs, 'profile')
  ingest(paymentInputs, 'payment')
  return out
}

/** Merge payment methods: profile (kind 0) event order, then payment (kind 10133) event order; deduplicated. */
export function mergePaymentMethods(
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null,
  profile: TProfile | null,
  profileEvent?: Event | null
): MergedPaymentMethod[] {
  let profileInputs = profileEvent
    ? extractProfileEventPaymentMethodsInOrder(profileEvent)
    : extractParsedProfilePaymentMethodsInOrder(profile)

  // Include parsed profile targets not represented in the raw event walk (e.g. cached profile row).
  if (profileEvent && profile) {
    profileInputs = appendUniquePaymentInputs(
      profileInputs,
      extractParsedProfilePaymentMethodsInOrder(profile)
    )
  }

  const paymentInputs = extractPaymentEventMethodsInOrder(paymentInfo)
  return mergeOrderedPaymentMethodLists(profileInputs, paymentInputs)
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

function compareMethodsWithinCategory(a: MergedPaymentMethod, b: MergedPaymentMethod): number {
  const aFromProfile = a.profileOrder != null
  const bFromProfile = b.profileOrder != null
  if (aFromProfile && bFromProfile) return a.profileOrder! - b.profileOrder!
  if (aFromProfile) return -1
  if (bFromProfile) return 1
  return (a.paymentOrder ?? 0) - (b.paymentOrder ?? 0)
}

/** Group payment methods by displayType (same headings as profile payment section). */
export function groupPaymentMethodsByDisplayType(methods: MergedPaymentMethod[]): PaymentMethodGroup[] {
  const groups = new Map<string, MergedPaymentMethod[]>()
  for (const method of methods) {
    const key = method.displayType || method.type
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(method)
  }
  for (const groupMethods of groups.values()) {
    groupMethods.sort(compareMethodsWithinCategory)
  }
  const order = Array.from(groups.keys()).sort((a, b) => {
    const typeA = groups.get(a)?.[0]?.type ?? ''
    const typeB = groups.get(b)?.[0]?.type ?? ''
    return paytoPaymentSortRank(typeA) - paytoPaymentSortRank(typeB)
  })
  return order.map((key) => ({ displayType: key, methods: groups.get(key) ?? [] }))
}

/**
 * Ordered Lightning targets for zaps: profile (kind 0) event order, then payment (kind 10133).
 * Optional `preferredAddress` is moved to the front.
 */
export function buildOrderedZapLightningAddresses(opts: {
  profileEvent?: Event | null
  /** Parsed kind 0 when the event is not loaded yet (e.g. feed profile row). */
  profile?: TProfile | null
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
  preferredAddress?: string | null
}): string[] {
  const ev = opts.profileEvent
  const profile =
    ev?.kind === kinds.Metadata ? getProfileFromEvent(ev) : (opts.profile ?? null)

  const addrs = mergePaymentMethods(opts.paymentInfo, profile, ev)
    .filter((m) => isZappableLightningPaytoType(m.type))
    .map((m) => m.authority)

  return prioritizeZapLightningAddress(addrs, opts.preferredAddress ?? undefined)
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
