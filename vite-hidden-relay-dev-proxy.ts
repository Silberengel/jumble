/**
 * Vite dev server: terminate browser WebSocket upgrades for `.onion` / `.i2p` relay URLs
 * via local Tor/I2P SOCKS (see {@link browserHiddenRelayDevProxyBase} in src/lib/hidden-network-relay.ts).
 */
import type { IncomingMessage } from 'http'
import type { Socket } from 'net'
import WebSocket, { WebSocketServer } from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Plugin } from 'vite'

const PROXY_PATH = '/__imwald/hidden-relay'

const DEFAULT_TOR_SOCKS = 'socks5://127.0.0.1:9050'
const DEFAULT_I2P_SOCKS = 'socks5://127.0.0.1:7657'

function relayHostname(relayUrl: string): string {
  try {
    return new URL(relayUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function hiddenNetworkRelayKind(relayUrl: string): 'tor' | 'i2p' | null {
  const host = relayHostname(relayUrl)
  if (host.endsWith('.onion')) return 'tor'
  if (host.endsWith('.i2p') || host.endsWith('.b32.i2p')) return 'i2p'
  return null
}

function isHiddenNetworkRelayUrl(relayUrl: string): boolean {
  return hiddenNetworkRelayKind(relayUrl) != null
}

function torSocksProxyUrl(): string {
  return process.env.IMWALD_TOR_SOCKS?.trim() || process.env.SCRIPTORIUM_TOR_SOCKS?.trim() || DEFAULT_TOR_SOCKS
}

function i2pSocksProxyUrl(): string {
  return process.env.IMWALD_I2P_SOCKS?.trim() || process.env.SCRIPTORIUM_I2P_SOCKS?.trim() || DEFAULT_I2P_SOCKS
}

function socksForTarget(targetUrl: string): string | undefined {
  const kind = hiddenNetworkRelayKind(targetUrl)
  if (kind === 'tor') return torSocksProxyUrl()
  if (kind === 'i2p') return i2pSocksProxyUrl()
  return undefined
}

export function hiddenRelayDevProxyPlugin(): Plugin {
  return {
    name: 'hidden-relay-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = req.url ?? ''
        if (!url.startsWith(`${PROXY_PATH}?`)) return

        let target = ''
        try {
          const parsed = new URL(url, 'http://127.0.0.1')
          target = parsed.searchParams.get('target')?.trim() ?? ''
        } catch {
          socket.destroy()
          return
        }
        if (!target || !isHiddenNetworkRelayUrl(target)) {
          socket.destroy()
          return
        }

        wss.handleUpgrade(req, socket, head, (browserWs) => {
          const socks = socksForTarget(target)
          const upstream = new WebSocket(target, socks ? { agent: new SocksProxyAgent(socks) } : undefined)

          const closeBoth = () => {
            try {
              browserWs.close()
            } catch {
              /* ignore */
            }
            try {
              upstream.close()
            } catch {
              /* ignore */
            }
          }

          browserWs.on('message', (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary })
            }
          })
          upstream.on('message', (data, isBinary) => {
            if (browserWs.readyState === WebSocket.OPEN) {
              browserWs.send(data, { binary: isBinary })
            }
          })
          browserWs.on('close', closeBoth)
          browserWs.on('error', closeBoth)
          upstream.on('close', closeBoth)
          upstream.on('error', closeBoth)
        })
      })
    }
  }
}
