/**
 * Wallet deep links and “open in app” targets driven by {@link ../data/payto-types.json}.
 */

import paytoTypesCatalog from '@/data/payto-types.json'
import type { PaytoWalletOpenRow } from '@/lib/payto-registry'
import { resolvePaypalPaymentUrl } from '@/lib/payto-paypal-url'

type PaytoBolt11InvoiceOpenConfig = {
  paytoType?: string
  coinScheme?: string
  walletApps: string[]
}

type PaytoTypeRecordWallet = {
  label?: string
  profileUrlTemplate?: string
  paymentOpen?: 'paypal'
  walletOpen?: PaytoWalletOpenRow
}

type PaytoWalletCatalogOpenWith = {
  bolt11Invoice?: PaytoBolt11InvoiceOpenConfig
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
  _openWith?: PaytoWalletCatalogOpenWith
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

/**
 * Zeus {@link https://github.com/ZeusLN/zeus/blob/master/utils/AddressUtils.ts processBIP21Uri}:
 * strips `zeusln:` then parses `lightning:` / bare `lno1` / `lnbc` payloads via handleAnything.
 */
export function buildZeusWalletHref(coinScheme: string, authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null
  const scheme = coinScheme.toLowerCase().trim()
  if (!scheme) return null
  const payload = auth.replace(/^lightning:/i, '')
  if (scheme === 'bolt12' || /^lno1/i.test(payload)) {
    return `zeusln:${payload}`
  }
  return `zeusln:lightning:${payload}`
}

/**
 * BlueWallet wiki: wrap BOLT11 / lightning targets as `bluewallet:lightning:…`.
 * @see https://github.com/BlueWallet/BlueWallet/wiki/Deeplinking
 */
export function buildBlueWalletWalletHref(authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null
  const payload = auth.replace(/^lightning:/i, '')
  if (!payload) return null
  return `bluewallet:lightning:${payload}`
}

const WALLET_APP_BUILDERS: Record<
  string,
  (coinScheme: string, authority: string) => string | null
> = {
  phoenix: buildPhoenixWalletHref,
  zeus: buildZeusWalletHref,
  bluewallet: (_coinScheme, authority) => buildBlueWalletWalletHref(authority)
}

function walletAppMeta(appId: string): WalletAppRowJson | undefined {
  return walletCatalog.walletApps?.[appId]
}

function paymentOpenHandlerFromHref(
  appId: string,
  coinScheme: string,
  href: string
): PaytoPaymentOpenHandler {
  const app = walletAppMeta(appId)
  return {
    id: `${appId}-${coinScheme}`,
    openTargetName: app?.label ?? appId,
    href,
    isHttp: false,
    mobileOnly: app?.mobileOnly !== false
  }
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
  const customBuild = WALLET_APP_BUILDERS[appId]
  if (customBuild) {
    return customBuild(coinScheme, auth)
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
  return paymentOpenHandlerFromHref('phoenix', coinScheme, href)
}

export function getZeusPaymentOpenHandler(
  coinScheme: string,
  authority: string
): PaytoPaymentOpenHandler | null {
  const href = buildZeusWalletHref(coinScheme, authority)
  if (!href) return null
  return paymentOpenHandlerFromHref('zeus', coinScheme, href)
}

/** BlueWallet BOLT11 handler (invoice must already be resolved). */
export function getBlueWalletPaymentOpenHandler(
  coinScheme: string,
  authority: string
): PaytoPaymentOpenHandler | null {
  const href = buildBlueWalletWalletHref(authority)
  if (!href) return null
  return paymentOpenHandlerFromHref('bluewallet', coinScheme, href)
}

function getBolt11InvoiceOpenConfig(): PaytoBolt11InvoiceOpenConfig | undefined {
  const cfg = walletCatalog._openWith?.bolt11Invoice
  if (!cfg?.walletApps?.length) return undefined
  return cfg
}

/** Build “Open with” handlers from catalog `_openWith.bolt11Invoice.walletApps`. */
function getBolt11InvoiceOpenHandlers(invoice: string): PaytoPaymentOpenHandler[] {
  const cfg = getBolt11InvoiceOpenConfig()
  if (!cfg) return []

  const paytoType = getCanonicalPaytoType(cfg.paytoType ?? 'lightning')
  const row = getPaytoTypeRecord(paytoType)?.walletOpen
  const auth = trimAuthority(invoice)
  if (!auth) return []

  const handlers: PaytoPaymentOpenHandler[] = []
  const seen = new Set<string>()
  for (const appId of cfg.walletApps) {
    const app = walletCatalog.walletApps?.[appId]
    const href = resolveWalletAppUri(appId, paytoType, auth, row)
    if (!app || !href || seen.has(href)) continue
    seen.add(href)
    handlers.push({
      id: `${paytoType}-${appId}-bolt11`,
      openTargetName: app.label,
      href,
      isHttp: false,
      mobileOnly: app.mobileOnly !== false
    })
  }
  return handlers
}

/** Handlers for a resolved BOLT11 shown after LNURL invoice creation (from {@link payto-types.json}). */
export function getLightningInvoiceWalletPaymentHandlers(
  authority: string
): PaytoPaymentOpenHandler[] {
  return getBolt11InvoiceOpenHandlers(authority)
}

export type PaytoPaymentOpenContext = {
  /** LUD-16 lightning address resolved to BOLT11 in {@link PaytoDialog}. */
  bolt11Invoice?: string | null
}

function walletActionToOpenHandler(action: PaytoWalletOpenAction): PaytoPaymentOpenHandler {
  return {
    id: action.id,
    openTargetName: action.label,
    href: action.href,
    isHttp: isPaytoHttpOpenUrl(action.href),
    mobileOnly: action.mobileOnly
  }
}

function dedupePaymentOpenHandlers(handlers: PaytoPaymentOpenHandler[]): PaytoPaymentOpenHandler[] {
  const seen = new Set<string>()
  return handlers.filter((h) => {
    if (seen.has(h.href)) return false
    seen.add(h.href)
    return true
  })
}

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
 * “Open with” targets for {@link PaytoDialog} — scoped to the active payto type only.
 * Native coin schemes (monero:, bitcoin:, …) are omitted; users copy the payto URI instead.
 */
export function getPaytoPaymentOpenHandlers(
  type: string,
  authority: string,
  context?: PaytoPaymentOpenContext
): PaytoPaymentOpenHandler[] {
  const canonical = getCanonicalPaytoType(type)
  const record = getPaytoTypeRecord(canonical)
  const auth = trimAuthority(authority)
  if (!auth || !record) return []

  const handlers: PaytoPaymentOpenHandler[] = []

  if (record.paymentOpen === 'paypal') {
    const href = resolvePaypalPaymentUrl(auth)
    if (href) {
      handlers.push({
        id: 'paypal',
        openTargetName: record.label ?? 'PayPal',
        href,
        isHttp: true,
        mobileOnly: false
      })
    }
    return dedupePaymentOpenHandlers(handlers)
  }

  const walletRow = record.walletOpen
  if (walletRow?.deferWalletAppsUntilBolt11) {
    if (context?.bolt11Invoice) {
      handlers.push(...getBolt11InvoiceOpenHandlers(context.bolt11Invoice))
    }
  } else if (walletRow?.walletApps?.length) {
    for (const action of getPaytoWalletOpenActions(type, auth)) {
      handlers.push(walletActionToOpenHandler(action))
    }
  }

  if (record.profileUrlTemplate) {
    handlers.push({
      id: `${canonical}-web`,
      openTargetName: record.label ?? canonical,
      href: substituteAuthority(record.profileUrlTemplate, encodeURIComponent(auth)),
      isHttp: true,
      mobileOnly: false
    })
  }

  return dedupePaymentOpenHandlers(handlers)
}

export function filterPaytoPaymentOpenHandlersForDevice(
  handlers: PaytoPaymentOpenHandler[]
): PaytoPaymentOpenHandler[] {
  if (isLikelyMobileWalletUserAgent()) return handlers
  return handlers.filter((h) => !h.mobileOnly)
}
