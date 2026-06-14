import { describe, expect, it } from 'vitest'
import {
  hiddenNetworkRelayKindForUrl,
  isHiddenNetworkRelayUrl,
  isI2pRelayHostname,
  isOnionRelayHostname,
  resolveHiddenNetworkRelayConnectPlan,
  setHiddenNetworkSocksSnapshot,
  torSocksProxyUrl
} from '@/lib/hidden-network-relay'

const CLEARNET = 'wss://relay.sovbit.host'

const ONION = 'ws://cwx3zhyyu3x64b7u5xj63toy56eyo35ohzsaxjs5ko2ackpapqi3qhyd.onion:7778'
const I2P = 'ws://hfv334dgnndidbgdi2rbbvrtimp2fqy5unpys5tumixhrr7gi2sa.b32.i2p:7778'

describe('hidden-network-relay', () => {
  it('classifies onion and i2p hostnames', () => {
    expect(isOnionRelayHostname('abc.onion')).toBe(true)
    expect(isI2pRelayHostname('foo.b32.i2p')).toBe(true)
    expect(hiddenNetworkRelayKindForUrl(ONION)).toBe('tor')
    expect(hiddenNetworkRelayKindForUrl(I2P)).toBe('i2p')
    expect(isHiddenNetworkRelayUrl('wss://relay.sovbit.host/')).toBe(false)
  })

  it('routes hidden URLs through IMWALD_HIDDEN_RELAY_TEST_GATEWAY when set', () => {
    const prev = process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY = 'wss://relay.sovbit.host'
    try {
      const torPlan = resolveHiddenNetworkRelayConnectPlan(ONION)
      expect(torPlan.viaTestGateway).toBe(true)
      expect(torPlan.dialUrl).toContain('relay.sovbit.host')
      expect(torPlan.logicalUrl).toContain('.onion')

      const i2pPlan = resolveHiddenNetworkRelayConnectPlan(I2P)
      expect(i2pPlan.viaTestGateway).toBe(true)
      expect(i2pPlan.dialUrl).toContain('relay.sovbit.host')
    } finally {
      if (prev == null) delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
      else process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY = prev
    }
  })

  it('assigns SOCKS proxies per hidden-network kind when no gateway', () => {
    const prevGateway = process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    try {
      const torPlan = resolveHiddenNetworkRelayConnectPlan(ONION)
      expect(torPlan.socksProxyUrl).toContain('9050')
      expect(torPlan.dialUrl).toContain('.onion')

      const i2pPlan = resolveHiddenNetworkRelayConnectPlan(I2P)
      expect(i2pPlan.socksProxyUrl).toContain('7657')
    } finally {
      if (prevGateway == null) delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
      else process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY = prevGateway
    }
  })

  it('routes hidden URLs through a loopback proxy base when provided', () => {
    const prevGateway = process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    try {
      const torPlan = resolveHiddenNetworkRelayConnectPlan(ONION, {
        proxyBase: 'ws://127.0.0.1:45280/__imwald/hidden-relay'
      })
      expect(torPlan.viaDevProxy).toBe(true)
      expect(torPlan.dialUrl).toContain('target=')
      expect(torPlan.dialUrl).toContain('.onion')
      expect(torPlan.socksProxyUrl).toBeUndefined()
    } finally {
      if (prevGateway == null) delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
      else process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY = prevGateway
    }
  })

  it('leaves clearnet URLs unchanged', () => {
    const plan = resolveHiddenNetworkRelayConnectPlan(CLEARNET)
    expect(plan.kind).toBeNull()
    expect(plan.dialUrl).toContain('relay.sovbit.host')
    expect(plan.viaTestGateway).toBe(false)
  })

  it('prefers probed Tor Browser SOCKS in snapshot over default daemon port', () => {
    const prevTor = process.env.IMWALD_TOR_SOCKS
    const prevScriptorium = process.env.SCRIPTORIUM_TOR_SOCKS
    delete process.env.IMWALD_TOR_SOCKS
    delete process.env.SCRIPTORIUM_TOR_SOCKS
    try {
      setHiddenNetworkSocksSnapshot({ tor: 'socks5://127.0.0.1:9150' })
      expect(torSocksProxyUrl()).toBe('socks5://127.0.0.1:9150')
    } finally {
      setHiddenNetworkSocksSnapshot({})
      if (prevTor == null) delete process.env.IMWALD_TOR_SOCKS
      else process.env.IMWALD_TOR_SOCKS = prevTor
      if (prevScriptorium == null) delete process.env.SCRIPTORIUM_TOR_SOCKS
      else process.env.SCRIPTORIUM_TOR_SOCKS = prevScriptorium
    }
  })
})
