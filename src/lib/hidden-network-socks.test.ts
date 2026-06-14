// @vitest-environment node
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  getTorSocksProxyUrlSync,
  refreshHiddenNetworkSocksCache
} = require('../../electron/hidden-network-socks.cjs') as {
  getTorSocksProxyUrlSync: () => string
  refreshHiddenNetworkSocksCache: () => Promise<{
    tor: { reachable: boolean; socksUrl: string; source: string }
  }>
}

describe('hidden-network-socks', () => {
  it('returns a default Tor SOCKS URL when nothing is reachable', async () => {
    const prevTor = process.env.IMWALD_TOR_SOCKS
    const prevScriptorium = process.env.SCRIPTORIUM_TOR_SOCKS
    delete process.env.IMWALD_TOR_SOCKS
    delete process.env.SCRIPTORIUM_TOR_SOCKS
    try {
      await refreshHiddenNetworkSocksCache()
      expect(getTorSocksProxyUrlSync()).toContain('9050')
    } finally {
      if (prevTor == null) delete process.env.IMWALD_TOR_SOCKS
      else process.env.IMWALD_TOR_SOCKS = prevTor
      if (prevScriptorium == null) delete process.env.SCRIPTORIUM_TOR_SOCKS
      else process.env.SCRIPTORIUM_TOR_SOCKS = prevScriptorium
    }
  })

  it('prefers IMWALD_TOR_SOCKS over auto-detection', async () => {
    const prev = process.env.IMWALD_TOR_SOCKS
    process.env.IMWALD_TOR_SOCKS = 'socks5://127.0.0.1:9150'
    try {
      const snapshot = await refreshHiddenNetworkSocksCache()
      expect(snapshot.tor.socksUrl).toBe('socks5://127.0.0.1:9150')
      expect(snapshot.tor.source).toBe('env')
      expect(getTorSocksProxyUrlSync()).toBe('socks5://127.0.0.1:9150')
    } finally {
      if (prev == null) delete process.env.IMWALD_TOR_SOCKS
      else process.env.IMWALD_TOR_SOCKS = prev
    }
  })
})
