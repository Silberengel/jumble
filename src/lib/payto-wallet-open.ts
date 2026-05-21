/**
 * Wallet deep links and “open in app” targets driven by {@link ../data/payto-types.json}.
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import type { PaytoWalletOpenRow } from '@/lib/payto-registry'
import { resolvePaypalPaymentUrl } from '@/lib/payto-paypal-url'

type PaytoTypeRecordWallet = {
  label?: string
  profileUrlTemplate?: string
  walletOpen?: PaytoWalletOpenRow
}

/** Labeled “open in …” action shown inside {@link PaytoDialog}. */
export type PaytoPaymentOpenHandler = {
  id: string
  /** App or service name for i18n: “Open in {{name}}”. */
  openTargetName: string
  href: string
  isHttp: boolean
  mobileOnly?: boolean
}

export type PaytoWalletOpenAction = {
  id: string
  label: string
  href: string
  /** Prefer showing on phones/tablets (e.g. Cake Wallet app scheme). */
  mobileOnly?: boolean
}

type WalletAppRowJson = {
  label: string
  mobileOnly?: boolean
  /** `cakewallet:{coinScheme}?address={authority}` — `{coinScheme}` from type's walletOpen.scheme or type id */
  uriTemplate: string
}

type PaytoWalletCatalogJson = {
  aliases?: Record<string, string>
  types: Record<string, PaytoTypeRecordWallet>
  walletApps?: Record<string, WalletAppRowJson>
}

const walletCatalog = paytoTypesCatalog as PaytoWalletCatalogJson
const PAYTO_ALIASES = walletCatalog.aliases ?? {}
const PAYTO_TYPES = walletCatalog.types

function getCanonicalPaytoType(type: string): string {
  const key = type.toLowerCase().trim()
  return PAYTO_ALIASES[key] ?? key
}

function getPaytoTypeRecord(type: string): PaytoTypeRecordWallet | undefined {
  return PAYTO_TYPES[getCanonicalPaytoType(type)]
}

function trimAuthority(authority: string): string {
  return authority.trim()
}

function substituteAuthority(template: string, authority: string): string {
  return template.split('{authority}').join(authority)
}

function buildQueryUri(scheme: string, path: string, query: Record<string, string>, authority: string): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    params.set(key, substituteAuthority(raw, authority))
  }
  const base = path ? `${scheme}:${path}` : `${scheme}:`
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function resolveWalletOpenRow(
  paytoType: string,
  authority: string,
  row: PaytoWalletOpenRow | undefined
): string | null {
  if (!row) return null
  const auth = trimAuthority(authority)
  if (!auth) return null
  if (row.requireAtSign && !auth.includes('@')) return null
  if (row.requirePrefix) {
    const prefix = row.requirePrefix.toLowerCase()
    if (!auth.toLowerCase().startsWith(prefix)) return null
  }
  if (/^https?:\/\//i.test(auth)) return auth

  const scheme = (row.scheme ?? paytoType).toLowerCase()
  if (row.style === 'query' && row.query) {
    return buildQueryUri(scheme, row.path ?? '', row.query, auth)
  }
  const pathPart = row.path ? `${row.path}/` : ''
  return `${scheme}:${pathPart}${auth}`
}

/**
 * Phoenix strips a `phoenix:` prefix, then parses the remainder (e.g. `lightning:lnbc…`).
 * Do not use `phoenix:pay?uri=…` — the app does not treat that as a payment request.
 */
export function buildPhoenixWalletHref(coinScheme: string, authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null
  const scheme = coinScheme.toLowerCase().trim()
  if (!scheme) return null
  const payload = auth.replace(/^lightning:/i, '')
  return `phoenix:${scheme}:${payload}`
}

function resolveWalletAppUri(
  appId: string,
  paytoType: string,
  authority: string,
  row: PaytoWalletOpenRow | undefined
): string | null {
  const app = walletCatalog.walletApps?.[appId]
  if (!app) return null
  const auth = trimAuthority(authority)
  if (!auth) return null
  const coinScheme = (row?.scheme ?? paytoType).toLowerCase()
  if (appId === 'phoenix') {
    return buildPhoenixWalletHref(coinScheme, auth)
  }
  const href = substituteAuthority(
    app.uriTemplate.replace(/\{coinScheme\}/g, coinScheme),
    auth
  )
  return href
}

/** Mobile Phoenix deep link for a concrete payment target (BOLT11, offer, lightning address, …). */
export function getPhoenixPaymentOpenHandler(
  coinScheme: string,
  authority: string
): PaytoPaymentOpenHandler | null {
  const href = buildPhoenixWalletHref(coinScheme, authority)
  if (!href) return null
  return {
    id: `phoenix-${coinScheme}`,
    openTargetName: walletCatalog.walletApps?.phoenix?.label ?? 'Phoenix',
    href,
    isHttp: false,
    mobileOnly: walletCatalog.walletApps?.phoenix?.mobileOnly !== false
  }
}

const PAYTO_TYPES_PHOENIX_REQUIRES_BOLT11 = new Set(['lightning'])

/**
 * Primary browser/OS URL for this payto target (wallet URI or https).
 * Returns null when the type should use copy-only or zap (caller checks zappable lightning).
 */
export function getPaytoPrimaryOpenUrl(type: string, authority: string): string | null {
  const canonical = getCanonicalPaytoType(type)
  const record = getPaytoTypeRecord(canonical)
  const auth = trimAuthority(authority)
  if (!auth || !record) return null

  const fromWallet = resolveWalletOpenRow(canonical, auth, record.walletOpen)
  if (fromWallet) return fromWallet

  const template = record.profileUrlTemplate
  if (template) {
    return substituteAuthority(template, encodeURIComponent(auth))
  }

  return null
}

/** Optional app-specific links (e.g. Cake Wallet on Android). */
export function getPaytoWalletOpenActions(type: string, authority: string): PaytoWalletOpenAction[] {
  const canonical = getCanonicalPaytoType(type)
  const record = getPaytoTypeRecord(canonical)
  const row = record?.walletOpen
  if (!row?.walletApps?.length) return []

  const auth = trimAuthority(authority)
  if (!auth) return []

  const out: PaytoWalletOpenAction[] = []
  for (const appId of row.walletApps) {
    const app = walletCatalog.walletApps?.[appId]
    const href = resolveWalletAppUri(appId, canonical, auth, row)
    if (!app || !href) continue
    out.push({
      id: `${canonical}-${appId}`,
      label: app.label,
      href,
      /** App deep links are mobile-only unless catalog sets `mobileOnly: false`. */
      mobileOnly: app.mobileOnly !== false
    })
  }
  return out
}

export function isPaytoHttpOpenUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

export function isLikelyMobileWalletUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export function filterWalletOpenActionsForDevice(
  actions: PaytoWalletOpenAction[]
): PaytoWalletOpenAction[] {
  if (isLikelyMobileWalletUserAgent()) return actions
  return actions.filter((a) => !a.mobileOnly)
}

/**
 * Named app/site open targets for PaytoDialog (https + walletApps only).
 * Native coin schemes (monero:, bitcoin:, …) are omitted — users copy the payto URI instead.
 */
export function getPaytoPaymentOpenHandlers(type: string, authority: string): PaytoPaymentOpenHandler[] {
  const canonical = getCanonicalPaytoType(type)
  const record = getPaytoTypeRecord(canonical)
  const auth = trimAuthority(authority)
  if (!auth || !record) return []

  const handlers: PaytoPaymentOpenHandler[] = []
  const seen = new Set<string>()

  const add = (
    id: string,
    openTargetName: string,
    href: string | null | undefined,
    mobileOnly?: boolean
  ) => {
    if (!href || seen.has(href)) return
    seen.add(href)
    handlers.push({
      id,
      openTargetName,
      href,
      isHttp: isPaytoHttpOpenUrl(href),
      mobileOnly
    })
  }

  if (canonical === 'paypal') {
    add('paypal', 'PayPal', resolvePaypalPaymentUrl(auth))
    return handlers
  }

  if (record.profileUrlTemplate) {
    add(
      `${canonical}-web`,
      record.label ?? canonical,
      substituteAuthority(record.profileUrlTemplate, encodeURIComponent(auth))
    )
  }

  for (const app of getPaytoWalletOpenActions(type, auth)) {
    if (app.label === 'Phoenix' && PAYTO_TYPES_PHOENIX_REQUIRES_BOLT11.has(canonical)) {
      continue
    }
    add(app.id, app.label, app.href, app.mobileOnly)
  }

  return handlers
}

export function filterPaytoPaymentOpenHandlersForDevice(
  handlers: PaytoPaymentOpenHandler[]
): PaytoPaymentOpenHandler[] {
  if (isLikelyMobileWalletUserAgent()) return handlers
  return handlers.filter((h) => !h.mobileOnly)
}
