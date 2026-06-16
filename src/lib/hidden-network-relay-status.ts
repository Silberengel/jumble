import { browserHiddenRelayDevProxyBase, setHiddenNetworkSocksSnapshot } from '@/lib/hidden-network-relay'

export type HiddenNetworkSocksSource =
  | 'env'
  | 'daemon'
  | 'tor-browser'
  | 'router'
  | 'unavailable'

export type HiddenNetworkSocksEndpointStatus = {
  reachable: boolean
  socksUrl: string
  source: HiddenNetworkSocksSource
}

export type HiddenNetworkRelayRuntime = 'dev-proxy' | 'browser-only' | 'node'

export type HiddenNetworkRelayStatus = {
  runtime: HiddenNetworkRelayRuntime
  proxyAvailable: boolean
  tor: HiddenNetworkSocksEndpointStatus
  i2p: HiddenNetworkSocksEndpointStatus
  checkedAt: number
}

const EMPTY_STATUS: HiddenNetworkRelayStatus = {
  runtime: 'browser-only',
  proxyAvailable: false,
  tor: { reachable: false, socksUrl: 'socks5://127.0.0.1:9050', source: 'unavailable' },
  i2p: { reachable: false, socksUrl: 'socks5://127.0.0.1:7657', source: 'unavailable' },
  checkedAt: 0
}

function currentRuntime(): HiddenNetworkRelayRuntime {
  if (browserHiddenRelayDevProxyBase()) return 'dev-proxy'
  return 'browser-only'
}

function applyStatusSnapshot(status: HiddenNetworkRelayStatus): HiddenNetworkRelayStatus {
  setHiddenNetworkSocksSnapshot({
    tor: status.tor.reachable ? status.tor.socksUrl : undefined,
    i2p: status.i2p.reachable ? status.i2p.socksUrl : undefined
  })
  return status
}

function normalizePayload(raw: unknown, runtime: HiddenNetworkRelayRuntime): HiddenNetworkRelayStatus {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_STATUS, runtime }
  }
  const data = raw as Partial<HiddenNetworkRelayStatus>
  const tor = data.tor
  const i2p = data.i2p
  return {
    runtime: data.runtime ?? runtime,
    proxyAvailable: data.proxyAvailable === true,
    tor: {
      reachable: tor?.reachable === true,
      socksUrl: typeof tor?.socksUrl === 'string' ? tor.socksUrl : EMPTY_STATUS.tor.socksUrl,
      source: (tor?.source as HiddenNetworkSocksSource) ?? 'unavailable'
    },
    i2p: {
      reachable: i2p?.reachable === true,
      socksUrl: typeof i2p?.socksUrl === 'string' ? i2p.socksUrl : EMPTY_STATUS.i2p.socksUrl,
      source: (i2p?.source as HiddenNetworkSocksSource) ?? 'unavailable'
    },
    checkedAt: typeof data.checkedAt === 'number' ? data.checkedAt : Date.now()
  }
}

export async function fetchHiddenNetworkRelayStatus(opts?: {
  force?: boolean
}): Promise<HiddenNetworkRelayStatus> {
  const runtime = currentRuntime()

  if (runtime === 'dev-proxy') {
    try {
      const query = opts?.force ? '?force=1' : ''
      const res = await fetch(`/__imwald/hidden-relay/status${query}`, {
        cache: 'no-store'
      })
      if (res.ok) {
        const raw = (await res.json()) as unknown
        return applyStatusSnapshot(normalizePayload(raw, 'dev-proxy'))
      }
    } catch {
      /* fall through */
    }
  }

  return applyStatusSnapshot({ ...EMPTY_STATUS, runtime })
}
