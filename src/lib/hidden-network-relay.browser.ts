import { useWebSocketImplementation } from 'nostr-tools/pool'
import {
  browserHiddenRelayDevProxyBase,
  resolveHiddenNetworkRelayConnectPlan
} from '@/lib/hidden-network-relay'

function createBrowserHiddenNetworkWebSocketClass(): typeof WebSocket {
  return class HiddenNetworkRelayWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const plan = resolveHiddenNetworkRelayConnectPlan(urlStr, {
        devProxyBase: browserHiddenRelayDevProxyBase()
      })
      super(plan.dialUrl, protocols)
    }
  } as typeof WebSocket
}

/** Browser: dev same-origin proxy or test gateway; clearnet uses native WebSocket. */
export function installBrowserHiddenNetworkRelayWebSocket(): void {
  useWebSocketImplementation(createBrowserHiddenNetworkWebSocketClass())
}
