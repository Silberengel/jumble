import { useWebSocketImplementation } from 'nostr-tools/pool'
import {
  browserHiddenRelayProxyBase,
  resolveHiddenNetworkRelayConnectPlan
} from '@/lib/hidden-network-relay'

function createBrowserHiddenNetworkWebSocketClass(): typeof WebSocket {
  return class HiddenNetworkRelayWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const plan = resolveHiddenNetworkRelayConnectPlan(urlStr, {
        proxyBase: browserHiddenRelayProxyBase()
      })
      super(plan.dialUrl, protocols)
    }
  } as typeof WebSocket
}

/** Browser: dev/Electron loopback proxy or test gateway; clearnet uses native WebSocket. */
export function installBrowserHiddenNetworkRelayWebSocket(): void {
  useWebSocketImplementation(createBrowserHiddenNetworkWebSocketClass())
}
