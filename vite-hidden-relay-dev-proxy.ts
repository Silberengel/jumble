/**
 * Vite dev server: terminate browser WebSocket upgrades for `.onion` / `.i2p` relay URLs
 * via local Tor/I2P SOCKS (see {@link browserHiddenRelayDevProxyBase} in src/lib/hidden-network-relay.ts).
 */
import { createRequire } from 'module'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)
const {
  attachHiddenRelayProxyUpgradeHandler,
  handleHiddenRelayStatusRequest,
  PROXY_PATH,
  STATUS_PATH,
  refreshHiddenNetworkSocksCache
} = require('./electron/hidden-relay-proxy.cjs') as {
  attachHiddenRelayProxyUpgradeHandler: (server: Server) => unknown
  handleHiddenRelayStatusRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    runtime: string
  ) => Promise<boolean>
  PROXY_PATH: string
  STATUS_PATH: string
  refreshHiddenNetworkSocksCache: () => Promise<unknown>
}

export { PROXY_PATH, STATUS_PATH }

export function hiddenRelayDevProxyPlugin(): Plugin {
  return {
    name: 'hidden-relay-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      void refreshHiddenNetworkSocksCache()
      server.middlewares.use((req, res, next) => {
        const pathname = (() => {
          try {
            return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
          } catch {
            return ''
          }
        })()
        if (pathname !== STATUS_PATH) {
          next()
          return
        }
        void handleHiddenRelayStatusRequest(req, res, 'dev-proxy').then((handled) => {
          if (!handled) next()
        })
      })
      if (server.httpServer) {
        attachHiddenRelayProxyUpgradeHandler(server.httpServer as Server)
      }
    }
  }
}
