'use strict'

const http = require('http')
const WebSocket = require('ws')
const { WebSocketServer } = require('ws')
const { SocksProxyAgent } = require('socks-proxy-agent')
const {
  getTorSocksProxyUrlSync,
  getI2pSocksProxyUrlSync,
  refreshHiddenNetworkSocksCache,
  getHiddenNetworkSocksStatus,
  buildHiddenNetworkRelayStatusPayload
} = require('./hidden-network-socks.cjs')

const PROXY_PATH = '/__imwald/hidden-relay'
const STATUS_PATH = `${PROXY_PATH}/status`

function relayHostname(relayUrl) {
  try {
    return new URL(relayUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function hiddenNetworkRelayKind(relayUrl) {
  const host = relayHostname(relayUrl)
  if (host.endsWith('.onion')) return 'tor'
  if (host.endsWith('.i2p') || host.endsWith('.b32.i2p')) return 'i2p'
  return null
}

function isHiddenNetworkRelayUrl(relayUrl) {
  return hiddenNetworkRelayKind(relayUrl) != null
}

function socksForTarget(targetUrl) {
  const kind = hiddenNetworkRelayKind(targetUrl)
  if (kind === 'tor') return getTorSocksProxyUrlSync()
  if (kind === 'i2p') return getI2pSocksProxyUrlSync()
  return undefined
}

function proxyBaseUrl(host, port) {
  return `ws://${host}:${port}${PROXY_PATH}`
}

async function handleHiddenRelayStatusRequest(req, res, runtime) {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return true
  }
  const force = (req.url ?? '').includes('force=1')
  await getHiddenNetworkSocksStatus({ force })
  const payload = buildHiddenNetworkRelayStatusPayload(runtime)
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
  return true
}

function attachHiddenRelayProxyUpgradeHandler(httpServer, wss = new WebSocketServer({ noServer: true })) {
  httpServer.on('upgrade', (req, socket, head) => {
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

  return wss
}

function attachHiddenRelayHttpHandler(
  handler = async (req, res, runtime) => handleHiddenRelayStatusRequest(req, res, runtime)
) {
  return async (req, res) => {
    const pathname = (() => {
      try {
        return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      } catch {
        return ''
      }
    })()
    if (pathname === STATUS_PATH) {
      await handler(req, res, 'electron')
      return
    }
    res.writeHead(404).end()
  }
}

function startHiddenRelayProxyServer(preferredPort) {
  return new Promise((resolve, reject) => {
    void refreshHiddenNetworkSocksCache()
    const server = http.createServer((req, res) => {
      void attachHiddenRelayHttpHandler()(req, res)
    })
    attachHiddenRelayProxyUpgradeHandler(server)

    const listenOn = (port, attempt) => {
      if (attempt >= 40) {
        reject(new Error('No free port for hidden relay proxy'))
        return
      }
      const onErr = (err) => {
        server.removeListener('error', onErr)
        if (err && err.code === 'EADDRINUSE') {
          listenOn(port + 1, attempt + 1)
        } else {
          reject(err)
        }
      }
      server.on('error', onErr)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onErr)
        const addr = server.address()
        const boundPort = typeof addr === 'object' && addr ? addr.port : port
        resolve({
          server,
          baseUrl: proxyBaseUrl('127.0.0.1', boundPort)
        })
      })
    }

    listenOn(preferredPort, 0)
  })
}

module.exports = {
  PROXY_PATH,
  STATUS_PATH,
  attachHiddenRelayProxyUpgradeHandler,
  attachHiddenRelayHttpHandler,
  handleHiddenRelayStatusRequest,
  startHiddenRelayProxyServer,
  refreshHiddenNetworkSocksCache,
  buildHiddenNetworkRelayStatusPayload,
  getHiddenNetworkSocksStatus
}
