import WebSocket from 'ws'
import { createRequire } from 'module'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { resolveHiddenNetworkRelayConnectPlan, setHiddenNetworkSocksSnapshot } from '@/lib/hidden-network-relay'

const require = createRequire(import.meta.url)
const {
  getTorSocksProxyUrlSync,
  getI2pSocksProxyUrlSync,
  refreshHiddenNetworkSocksCache
} = require('../../electron/hidden-network-socks.cjs') as {
  getTorSocksProxyUrlSync: () => string
  getI2pSocksProxyUrlSync: () => string
  refreshHiddenNetworkSocksCache: () => Promise<{
    tor: { reachable: boolean; socksUrl: string }
    i2p: { reachable: boolean; socksUrl: string }
  }>
}

function socksProxyUrlForPlan(plan: ReturnType<typeof resolveHiddenNetworkRelayConnectPlan>): string | undefined {
  if (!plan.kind) return undefined
  return plan.kind === 'tor' ? getTorSocksProxyUrlSync() : getI2pSocksProxyUrlSync()
}

function createHiddenNetworkAwareWebSocketClass(): typeof WebSocket {
  return class HiddenNetworkRelayWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const plan = resolveHiddenNetworkRelayConnectPlan(urlStr)
      const socksProxyUrl = plan.socksProxyUrl ? socksProxyUrlForPlan(plan) : undefined
      if (socksProxyUrl) {
        const agent = new SocksProxyAgent(socksProxyUrl)
        super(plan.dialUrl, protocols, { agent })
        return
      }
      super(plan.dialUrl, protocols)
    }
  } as unknown as typeof WebSocket
}

/** Install Node `ws` + optional SOCKS for `.onion` / `.i2p` relay URLs (vitest, scripts). */
export function installNodeHiddenNetworkRelayWebSocket(): void {
  void refreshHiddenNetworkSocksCache().then((snapshot) => {
    setHiddenNetworkSocksSnapshot({
      tor: snapshot.tor.reachable ? snapshot.tor.socksUrl : undefined,
      i2p: snapshot.i2p.reachable ? snapshot.i2p.socksUrl : undefined
    })
  })
  useWebSocketImplementation(createHiddenNetworkAwareWebSocketClass())
}
