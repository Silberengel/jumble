/**
 * Payto payment targets: wallet deep links, profile URLs, and PaytoDialog “Open with” handlers.
 * Driven entirely by {@link ../data/payto-types.json} (see {@link ./payto-registry}).
 */

import {
  getBolt11InvoiceOpenConfig,
  getCanonicalPaytoType,
  getPaytoTypeRecord,
  getWalletApp,
  resolvePaypalProfileUrl,
  type PaytoWalletAppBuilderId,
  type PaytoWalletOpenRow
} from '@/lib/payto-registry'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Labeled target for PaytoDialog dropdown + open button. */
export type PaytoPaymentOpenHandler = {
  id: string
  openTargetName: string
  href: string
  isHttp: boolean
  mobileOnly?: boolean
}

export type PaytoPaymentOpenContext = {
  /** LUD-16 lightning address resolved to BOLT11 in PaytoDialog. */
  bolt11Invoice?: string | null
}

// ─── URI helpers ─────────────────────────────────────────────────────────────

function trimAuthority(authority: string): string {
  return authority.trim()
}

function substituteAuthority(template: string, authority: string): string {
  return template.split('{authority}').join(authority)
}

function buildQueryUri(
  scheme: string,
  path: string,
  query: Record<string, string>,
  authority: string
): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    params.set(key, substituteAuthority(raw, authority))
  }
  const base = path ? `${scheme}:${path}` : `${scheme}:`
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** Native `scheme:…` URI from a type’s `walletOpen` row (not app deep links). */
export function resolveNativeWalletUri(
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

export function buildPhoenixWalletHref(coinScheme: string, authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null
  const scheme = coinScheme.toLowerCase().trim()
  if (!scheme) return null
  const payload = auth.replace(/^lightning:/i, '')
  return `phoenix:${scheme}:${payload}`
}

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

export function buildBlueWalletWalletHref(authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null
  const payload = auth.replace(/^lightning:/i, '')
  if (!payload) return null
  return `bluewallet:lightning:${payload}`
}

/** Ledger Live `currency` query values for {@link ledgerlive://send}. */
const LEDGER_SEND_CURRENCY: Record<string, string> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  monero: 'monero',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  bitcoincash: 'bitcoin_cash',
  solana: 'solana'
}

/** Opens Send with currency + recipient (desktop); mobile at least prefills currency. */
export function buildLedgerWalletHref(coinScheme: string, authority: string): string | null {
  const currency = LEDGER_SEND_CURRENCY[coinScheme.toLowerCase()]
  if (!currency) return null
  const recipient = trimAuthority(authority)
  if (!recipient) return null
  const params = new URLSearchParams({ currency, recipient })
  return `ledgerlive://send?${params.toString()}`
}

const WALLET_APP_BUILDERS: Record<
  PaytoWalletAppBuilderId,
  (coinScheme: string, authority: string) => string | null
> = {
  phoenix: buildPhoenixWalletHref,
  zeus: buildZeusWalletHref,
  bluewallet: (_coinScheme, authority) => buildBlueWalletWalletHref(authority),
  ledger: buildLedgerWalletHref
}

/** Deep link for a catalog `walletApps` entry and payto type context. */
export function resolveWalletAppHref(
  appId: string,
  paytoType: string,
  authority: string,
  walletOpen: PaytoWalletOpenRow | undefined
): string | null {
  const app = getWalletApp(appId)
  if (!app) return null
  const auth = trimAuthority(authority)
  if (!auth) return null

  const coinScheme = (walletOpen?.scheme ?? paytoType).toLowerCase()
  if (app.builder) {
    const build = WALLET_APP_BUILDERS[app.builder]
    if (build) return build(coinScheme, auth)
  }
  const template = walletOpen?.walletAppUriTemplates?.[appId] ?? app.uriTemplate
  if (!template) return null
  const payload =
    coinScheme === 'lightning' || coinScheme === 'bolt12'
      ? auth.replace(/^lightning:/i, '')
      : auth
  return substituteAuthority(template.replace(/\{coinScheme\}/g, coinScheme), payload)
}

/** Primary open URL: native wallet URI, then profile web template. */
export function resolvePaytoProfileUrl(type: string, authority: string): string | null {
  const auth = trimAuthority(authority)
  if (!auth) return null

  const canonical = getCanonicalPaytoType(type)
  if (getPaytoTypeRecord(canonical)?.paymentOpen === 'paypal') {
    return resolvePaypalProfileUrl(auth)
  }

  const record = getPaytoTypeRecord(canonical)
  const fromWallet = resolveNativeWalletUri(canonical, auth, record?.walletOpen)
  if (fromWallet) return fromWallet

  const template = record?.profileUrlTemplate
  if (!template) return null
  return substituteAuthority(template, encodeURIComponent(auth))
}

export function isPaytoHttpOpenUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

// ─── Payment open handlers (PaytoDialog) ─────────────────────────────────────

function dedupeHandlers(handlers: PaytoPaymentOpenHandler[]): PaytoPaymentOpenHandler[] {
  const seen = new Set<string>()
  return handlers.filter((h) => {
    if (seen.has(h.href)) return false
    seen.add(h.href)
    return true
  })
}

function handlerFromWalletApp(
  appId: string,
  paytoType: string,
  authority: string,
  walletOpen: PaytoWalletOpenRow | undefined,
  idSuffix = ''
): PaytoPaymentOpenHandler | null {
  const app = getWalletApp(appId)
  const href = resolveWalletAppHref(appId, paytoType, authority, walletOpen)
  if (!app || !href) return null
  const canonical = getCanonicalPaytoType(paytoType)
  return {
    id: `${canonical}-${appId}${idSuffix}`,
    openTargetName: app.label,
    href,
    isHttp: false,
    mobileOnly: app.mobileOnly !== false
  }
}

function handlersForWalletAppIds(
  appIds: string[],
  paytoType: string,
  authority: string,
  walletOpen: PaytoWalletOpenRow | undefined,
  idSuffix = ''
): PaytoPaymentOpenHandler[] {
  const handlers: PaytoPaymentOpenHandler[] = []
  for (const appId of appIds) {
    const h = handlerFromWalletApp(appId, paytoType, authority, walletOpen, idSuffix)
    if (h) handlers.push(h)
  }
  return handlers
}

function handlersForBolt11Invoice(invoice: string): PaytoPaymentOpenHandler[] {
  const cfg = getBolt11InvoiceOpenConfig()
  if (!cfg) return []

  const paytoType = getCanonicalPaytoType(cfg.paytoType ?? 'lightning')
  const walletOpen = getPaytoTypeRecord(paytoType)?.walletOpen
  return handlersForWalletAppIds(cfg.walletApps, paytoType, invoice, walletOpen, '-bolt11')
}

function handlerForProfileWeb(
  canonical: string,
  label: string,
  authority: string,
  template: string
): PaytoPaymentOpenHandler {
  return {
    id: `${canonical}-web`,
    openTargetName: label,
    href: substituteAuthority(template, encodeURIComponent(authority)),
    isHttp: true,
    mobileOnly: false
  }
}

/**
 * “Open with” options for PaytoDialog for one payto type + authority.
 * Only includes targets configured in the catalog for that type.
 */
export function resolvePaytoPaymentOpenHandlers(
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
    const href = resolvePaypalProfileUrl(auth)
    if (href) {
      handlers.push({
        id: 'paypal',
        openTargetName: record.label,
        href,
        isHttp: true,
        mobileOnly: false
      })
    }
    return dedupeHandlers(handlers)
  }

  const walletOpen = record.walletOpen
  if (walletOpen?.deferWalletAppsUntilBolt11) {
    if (context?.bolt11Invoice) {
      handlers.push(...handlersForBolt11Invoice(context.bolt11Invoice))
    }
  } else if (walletOpen?.walletApps?.length) {
    handlers.push(...handlersForWalletAppIds(walletOpen.walletApps, canonical, auth, walletOpen))
  }

  if (record.profileUrlTemplate) {
    handlers.push(handlerForProfileWeb(canonical, record.label, auth, record.profileUrlTemplate))
  }

  return dedupeHandlers(handlers)
}

export function isLikelyMobileWalletUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export function filterPaytoPaymentOpenHandlersForDevice(
  handlers: PaytoPaymentOpenHandler[]
): PaytoPaymentOpenHandler[] {
  if (isLikelyMobileWalletUserAgent()) return handlers
  return handlers.filter((h) => !h.mobileOnly)
}

/** Open a resolved payto / wallet URL (https in a new tab, coin schemes via assign). */
export function openPaytoResolvedUrl(url: string): void {
  if (isPaytoHttpOpenUrl(url)) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  window.location.assign(url)
}

/** Open a resolved handler (new tab for https, assign for wallet schemes). */
export function openPaytoPaymentTarget(handler: PaytoPaymentOpenHandler): void {
  openPaytoResolvedUrl(handler.href)
}
