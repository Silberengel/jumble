import WebSocket from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { resolveHiddenNetworkRelayConnectPlan } from '@/lib/hidden-network-relay'

function createHiddenNetworkAwareWebSocketClass(): typeof WebSocket {
  return class HiddenNetworkRelayWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const plan = resolveHiddenNetworkRelayConnectPlan(urlStr)
      if (plan.socksProxyUrl) {
        const agent = new SocksProxyAgent(plan.socksProxyUrl)
        super(plan.dialUrl, protocols, { agent })
        return
      }
      super(plan.dialUrl, protocols)
    }
  } as unknown as typeof WebSocket
}

/** Install Node `ws` + optional SOCKS for `.onion` / `.i2p` relay URLs (vitest, scripts). */
export function installNodeHiddenNetworkRelayWebSocket(): void {
  useWebSocketImplementation(createHiddenNetworkAwareWebSocketClass())
}
