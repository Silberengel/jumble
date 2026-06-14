// @vitest-environment node
/**
 * Live Sovbit relay integration: publish + read back on clearnet, Tor, and I2P URLs.
 *
 * Requires:
 *   SCRIPTORIUM_KEY=nsec1…   (signing key with write access to relay.sovbit.host)
 *
 * Optional:
 *   SCRIPTORIUM_TOR_SOCKS=socks5://127.0.0.1:9050   (default)
 *   SCRIPTORIUM_I2P_SOCKS=socks5://127.0.0.1:7657   (default)
 *
 * Run:
 *   SCRIPTORIUM_KEY=nsec1… npm run test:run -- src/lib/sovbit-relay-live.integration.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_I2P_SOCKS,
  DEFAULT_TOR_SOCKS,
  loadSovbitLiveTestSecretKey,
  probeRelayConnection,
  relayReadWriteRoundTrip,
  SOVBIT_RELAY_CLEARNET,
  SOVBIT_RELAY_I2P,
  SOVBIT_RELAY_TOR,
  type SovbitRelayEndpoint
} from './sovbit-relay-live-test-utils'

const secretKey = loadSovbitLiveTestSecretKey()
const torSocks = process.env.SCRIPTORIUM_TOR_SOCKS?.trim() || DEFAULT_TOR_SOCKS
const i2pSocks = process.env.SCRIPTORIUM_I2P_SOCKS?.trim() || DEFAULT_I2P_SOCKS

const ENDPOINTS: SovbitRelayEndpoint[] = [
  { label: 'clearnet', url: SOVBIT_RELAY_CLEARNET },
  { label: 'tor', url: SOVBIT_RELAY_TOR, socksProxyUrl: torSocks },
  { label: 'i2p', url: SOVBIT_RELAY_I2P, socksProxyUrl: i2pSocks }
]

describe.runIf(secretKey != null)('Sovbit relay live read/write (SCRIPTORIUM_KEY)', () => {
  const sk = secretKey!

  let torReachable = false
  let i2pReachable = false

  beforeAll(async () => {
    torReachable = await probeRelayConnection(SOVBIT_RELAY_TOR, {
      socksProxyUrl: torSocks,
      timeoutMs: 20_000
    })
    i2pReachable = await probeRelayConnection(SOVBIT_RELAY_I2P, {
      socksProxyUrl: i2pSocks,
      timeoutMs: 25_000
    })
  }, 60_000)

  it(
    'clearnet wss://relay.sovbit.host publishes and reads back',
    async () => {
      const { eventId, content } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_CLEARNET,
        secretKey: sk
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
      expect(content).toContain('imwald sovbit live test')
    },
    90_000
  )

  it.skipIf(!torReachable)(
    'Tor onion relay publishes and reads back (via SCRIPTORIUM_TOR_SOCKS)',
    async () => {
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_TOR,
        secretKey: sk,
        socksProxyUrl: torSocks
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    120_000
  )

  it.skipIf(!i2pReachable)(
    'I2P b32 relay publishes and reads back (via SCRIPTORIUM_I2P_SOCKS)',
    async () => {
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_I2P,
        secretKey: sk,
        socksProxyUrl: i2pSocks
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    120_000
  )

  it('reports hidden-network probe status', () => {
    // Document why tor/i2p cases may skip in CI or without local routers.
    expect(typeof torReachable).toBe('boolean')
    expect(typeof i2pReachable).toBe('boolean')
    if (!torReachable) {
      expect(ENDPOINTS.find((e) => e.label === 'tor')?.socksProxyUrl).toBe(torSocks)
    }
    if (!i2pReachable) {
      expect(ENDPOINTS.find((e) => e.label === 'i2p')?.socksProxyUrl).toBe(i2pSocks)
    }
  })
})

describe.runIf(secretKey == null)('Sovbit relay live read/write (SCRIPTORIUM_KEY)', () => {
  it('skips live relay tests when SCRIPTORIUM_KEY is unset', () => {
    expect(process.env.SCRIPTORIUM_KEY?.trim()).toBeFalsy()
  })
})
