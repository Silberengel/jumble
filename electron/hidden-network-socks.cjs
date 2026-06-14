'use strict'

const net = require('net')

const DEFAULT_TOR_DAEMON_SOCKS = 'socks5://127.0.0.1:9050'
const DEFAULT_TOR_BROWSER_SOCKS = 'socks5://127.0.0.1:9150'
const DEFAULT_I2P_SOCKS = 'socks5://127.0.0.1:7657'

const TOR_DAEMON_PORT = 9050
const TOR_BROWSER_PORT = 9150
const I2P_PORT = 7657

const CACHE_TTL_MS = 15_000

/** @type {{ tor: { reachable: boolean; socksUrl: string; source: string }; i2p: { reachable: boolean; socksUrl: string; source: string }; checkedAt: number } | null} */
let cache = null

function readTorEnv() {
  return process.env.IMWALD_TOR_SOCKS?.trim() || process.env.SCRIPTORIUM_TOR_SOCKS?.trim() || ''
}

function readI2pEnv() {
  return process.env.IMWALD_I2P_SOCKS?.trim() || process.env.SCRIPTORIUM_I2P_SOCKS?.trim() || ''
}

function probeTcpPort(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (ok) => {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

function socksPortFromUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.port) return Number(parsed.port)
    return parsed.protocol === 'socks5:' || parsed.protocol === 'socks:' ? 1080 : 0
  } catch {
    return 0
  }
}

async function probeSocksEnvUrl(url, fallbackSource) {
  const port = socksPortFromUrl(url)
  if (!port) {
    return { reachable: false, socksUrl: url, source: fallbackSource }
  }
  let host = '127.0.0.1'
  try {
    host = new URL(url).hostname || host
  } catch {
    /* ignore */
  }
  const reachable = await probeTcpPort(host, port)
  return { reachable, socksUrl: url, source: fallbackSource }
}

async function resolveTorSocksStatus() {
  const env = readTorEnv()
  if (env) return probeSocksEnvUrl(env, 'env')
  if (await probeTcpPort('127.0.0.1', TOR_DAEMON_PORT)) {
    return { reachable: true, socksUrl: DEFAULT_TOR_DAEMON_SOCKS, source: 'daemon' }
  }
  if (await probeTcpPort('127.0.0.1', TOR_BROWSER_PORT)) {
    return { reachable: true, socksUrl: DEFAULT_TOR_BROWSER_SOCKS, source: 'tor-browser' }
  }
  return { reachable: false, socksUrl: DEFAULT_TOR_DAEMON_SOCKS, source: 'unavailable' }
}

async function resolveI2pSocksStatus() {
  const env = readI2pEnv()
  if (env) return probeSocksEnvUrl(env, 'env')
  if (await probeTcpPort('127.0.0.1', I2P_PORT)) {
    return { reachable: true, socksUrl: DEFAULT_I2P_SOCKS, source: 'router' }
  }
  return { reachable: false, socksUrl: DEFAULT_I2P_SOCKS, source: 'unavailable' }
}

async function refreshHiddenNetworkSocksCache() {
  const [tor, i2p] = await Promise.all([resolveTorSocksStatus(), resolveI2pSocksStatus()])
  cache = { tor, i2p, checkedAt: Date.now() }
  return cache
}

function getHiddenNetworkSocksCache() {
  if (!cache || Date.now() - cache.checkedAt > CACHE_TTL_MS) return null
  return cache
}

async function getHiddenNetworkSocksStatus(opts = {}) {
  const force = opts.force === true
  const cached = getHiddenNetworkSocksCache()
  if (!force && cached) return cached
  return refreshHiddenNetworkSocksCache()
}

function getTorSocksProxyUrlSync() {
  const env = readTorEnv()
  if (env) return env
  if (cache?.tor?.reachable) return cache.tor.socksUrl
  return DEFAULT_TOR_DAEMON_SOCKS
}

function getI2pSocksProxyUrlSync() {
  const env = readI2pEnv()
  if (env) return env
  if (cache?.i2p?.reachable) return cache.i2p.socksUrl
  return DEFAULT_I2P_SOCKS
}

function buildHiddenNetworkRelayStatusPayload(runtime) {
  const snapshot = cache ?? {
    tor: { reachable: false, socksUrl: DEFAULT_TOR_DAEMON_SOCKS, source: 'unavailable' },
    i2p: { reachable: false, socksUrl: DEFAULT_I2P_SOCKS, source: 'unavailable' },
    checkedAt: 0
  }
  return {
    runtime,
    proxyAvailable: runtime === 'dev-proxy' || runtime === 'electron',
    tor: snapshot.tor,
    i2p: snapshot.i2p,
    checkedAt: snapshot.checkedAt
  }
}

module.exports = {
  DEFAULT_TOR_DAEMON_SOCKS,
  DEFAULT_TOR_BROWSER_SOCKS,
  DEFAULT_I2P_SOCKS,
  refreshHiddenNetworkSocksCache,
  getHiddenNetworkSocksStatus,
  getTorSocksProxyUrlSync,
  getI2pSocksProxyUrlSync,
  buildHiddenNetworkRelayStatusPayload
}
