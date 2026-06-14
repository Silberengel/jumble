import { describe, expect, it } from 'vitest'
import {
  hiddenNetworkRelayKindForUrl,
  isHiddenNetworkRelayUrl,
  isI2pRelayHostname,
  isOnionRelayHostname,
  resolveHiddenNetworkRelayConnectPlan
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

  it('leaves clearnet URLs unchanged', () => {
    const plan = resolveHiddenNetworkRelayConnectPlan(CLEARNET)
    expect(plan.kind).toBeNull()
    expect(plan.dialUrl).toContain('relay.sovbit.host')
    expect(plan.viaTestGateway).toBe(false)
  })
})
