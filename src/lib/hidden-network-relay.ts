/** Default Tor SOCKS (system daemon). */
export const DEFAULT_TOR_SOCKS_URL = 'socks5://127.0.0.1:9050'
/** Tor Browser bundled tor (when running). */
export const DEFAULT_TOR_BROWSER_SOCKS_URL = 'socks5://127.0.0.1:9150'
/** Default I2P router SOCKS outproxy. */
export const DEFAULT_I2P_SOCKS_URL = 'socks5://127.0.0.1:7657'

export type HiddenNetworkRelayKind = 'tor' | 'i2p'

export type HiddenNetworkRelayConnectPlan = {
  /** URL passed to the WebSocket constructor (may differ from the logical relay URL). */
  dialUrl: string
  /** Logical relay URL used as the nostr-tools pool key. */
  logicalUrl: string
  kind: HiddenNetworkRelayKind | null
  socksProxyUrl?: string
  viaTestGateway: boolean
  viaDevProxy: boolean
}

function readEnv(name: string): string {
  try {
    return (typeof process !== 'undefined' ? process.env[name] : undefined)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function hiddenNetworkRelayTestGatewayUrl(): string {
  return readEnv('IMWALD_HIDDEN_RELAY_TEST_GATEWAY')
}

let hiddenNetworkSocksSnapshot: { tor?: string; i2p?: string } = {}

/** Apply probed SOCKS URLs from the local status service (Tor Browser :9150, etc.). */
export function setHiddenNetworkSocksSnapshot(snapshot: { tor?: string; i2p?: string }): void {
  hiddenNetworkSocksSnapshot = { ...snapshot }
}

export function torSocksProxyUrl(): string {
  return (
    readEnv('IMWALD_TOR_SOCKS') ||
    readEnv('SCRIPTORIUM_TOR_SOCKS') ||
    hiddenNetworkSocksSnapshot.tor ||
    DEFAULT_TOR_SOCKS_URL
  )
}

export function i2pSocksProxyUrl(): string {
  return (
    readEnv('IMWALD_I2P_SOCKS') ||
    readEnv('SCRIPTORIUM_I2P_SOCKS') ||
    hiddenNetworkSocksSnapshot.i2p ||
    DEFAULT_I2P_SOCKS_URL
  )
}

export function relayHostname(relayUrl: string): string {
  try {
    return new URL(relayUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isOnionRelayHostname(hostname: string): boolean {
  return hostname.endsWith('.onion')
}

export function isI2pRelayHostname(hostname: string): boolean {
  return hostname.endsWith('.i2p') || hostname.endsWith('.b32.i2p')
}

export function hiddenNetworkRelayKindForUrl(relayUrl: string): HiddenNetworkRelayKind | null {
  const host = relayHostname(relayUrl)
  if (isOnionRelayHostname(host)) return 'tor'
  if (isI2pRelayHostname(host)) return 'i2p'
  return null
}

export function isHiddenNetworkRelayUrl(relayUrl: string): boolean {
  return hiddenNetworkRelayKindForUrl(relayUrl) != null
}

function normalizeRelayDialUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  try {
    const p = new URL(trimmed)
    if (p.protocol !== 'ws:' && p.protocol !== 'wss:') return trimmed
    p.pathname = p.pathname.replace(/\/+/g, '/')
    if (p.pathname.endsWith('/') && p.pathname.length > 1) {
      p.pathname = p.pathname.slice(0, -1)
    }
    if ((p.port === '80' && p.protocol === 'ws:') || (p.port === '443' && p.protocol === 'wss:')) {
      p.port = ''
    }
    return p.toString()
  } catch {
    return trimmed
  }
}

/** Build dial plan for a logical relay URL (clearnet, Tor, or I2P). */
export function resolveHiddenNetworkRelayConnectPlan(
  relayUrl: string,
  opts?: { proxyBase?: string | null; devProxyBase?: string | null }
): HiddenNetworkRelayConnectPlan {
  const logicalUrl = normalizeRelayDialUrl(relayUrl)
  const kind = hiddenNetworkRelayKindForUrl(logicalUrl)
  if (!kind) {
    return {
      dialUrl: logicalUrl,
      logicalUrl,
      kind: null,
      viaTestGateway: false,
      viaDevProxy: false
    }
  }

  const gateway = hiddenNetworkRelayTestGatewayUrl()
  if (gateway) {
    return {
      dialUrl: normalizeRelayDialUrl(gateway),
      logicalUrl,
      kind,
      viaTestGateway: true,
      viaDevProxy: false
    }
  }

  const proxyBase = opts?.proxyBase ?? opts?.devProxyBase ?? null
  if (proxyBase) {
    return {
      dialUrl: `${proxyBase.replace(/\/$/, '')}?target=${encodeURIComponent(logicalUrl)}`,
      logicalUrl,
      kind,
      viaDevProxy: true,
      viaTestGateway: false
    }
  }

  return {
    dialUrl: logicalUrl,
    logicalUrl,
    kind,
    socksProxyUrl: kind === 'tor' ? torSocksProxyUrl() : i2pSocksProxyUrl(),
    viaTestGateway: false,
    viaDevProxy: false
  }
}

function isNodeLikeRuntime(): boolean {
  return typeof window === 'undefined'
}

let electronHiddenRelayProxyBaseCache: string | null | undefined

function readElectronHiddenRelayProxyBase(): string | null {
  if (typeof window === 'undefined') return null
  if (electronHiddenRelayProxyBaseCache !== undefined) {
    return electronHiddenRelayProxyBaseCache
  }
  const bridge = window.imwaldElectron
  const raw =
    typeof bridge?.hiddenRelayProxyBase === 'function'
      ? bridge.hiddenRelayProxyBase()
      : typeof bridge?.hiddenRelayProxyBase === 'string'
        ? bridge.hiddenRelayProxyBase
        : null
  electronHiddenRelayProxyBaseCache = raw?.trim() || null
  return electronHiddenRelayProxyBaseCache
}

/** Same-origin dev proxy path (Vite plugin terminates SOCKS on the server). */
export function browserHiddenRelayDevProxyBase(): string | null {
  if (typeof window === 'undefined') return null
  try {
    if (!import.meta.env.DEV) return null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/__imwald/hidden-relay`
  } catch {
    return null
  }
}

/** Loopback desktop proxy (Electron main process terminates SOCKS). */
export function browserHiddenRelayElectronProxyBase(): string | null {
  return readElectronHiddenRelayProxyBase()
}

/** Dev same-origin proxy or packaged Electron loopback proxy. */
export function browserHiddenRelayProxyBase(): string | null {
  return browserHiddenRelayDevProxyBase() ?? browserHiddenRelayElectronProxyBase()
}

/** When set, explains why a hidden-network relay cannot be opened in this runtime. */
export function hiddenNetworkRelayUnavailableReason(relayUrl: string): string | null {
  if (!isHiddenNetworkRelayUrl(relayUrl)) return null
  const plan = resolveHiddenNetworkRelayConnectPlan(relayUrl, {
    proxyBase: browserHiddenRelayProxyBase()
  })
  if (plan.viaTestGateway || plan.viaDevProxy) return null
  if (plan.socksProxyUrl && isNodeLikeRuntime()) return null
  return (
    '[hidden-network-relay] Tor or I2P router required for ' +
    `${relayHostname(relayUrl)} — add a clearnet relay URL, run Tor/I2P with SOCKS, or use the desktop app`
  )
}

export function socksProxyUrlForHiddenNetworkKind(kind: HiddenNetworkRelayKind): string {
  return kind === 'tor' ? torSocksProxyUrl() : i2pSocksProxyUrl()
}
