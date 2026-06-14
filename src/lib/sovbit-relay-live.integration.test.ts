// @vitest-environment node
/**
 * Live Sovbit relay integration: publish + read back on clearnet, Tor, and I2P URLs.
 *
 * Requires:
 *   SCRIPTORIUM_KEY=nsec1…   (signing key with write access to relay.sovbit.host)
 *
 * Gateway mode (default in this file's first suite): hidden URLs dial clearnet Sovbit
 * (same backend, three addresses). Set IMWALD_HIDDEN_RELAY_TEST_GATEWAY yourself to override.
 *
 * Real SOCKS suite (second suite): requires local Tor (9050) and/or I2P (7657) with gateway unset.
 *
 * Optional SOCKS overrides:
 *   SCRIPTORIUM_TOR_SOCKS=socks5://127.0.0.1:9050
 *   SCRIPTORIUM_I2P_SOCKS=socks5://127.0.0.1:7657
 *
 * Run:
 *   SCRIPTORIUM_KEY=nsec1… npm run test:run -- src/lib/sovbit-relay-live.integration.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadSovbitLiveTestSecretKey,
  localHiddenNetworkSocksAvailability,
  relayReadWriteRoundTrip,
  SOVBIT_RELAY_CLEARNET,
  SOVBIT_RELAY_I2P,
  SOVBIT_RELAY_TOR,
  installSovbitLiveTestRelayTransport
} from './sovbit-relay-live-test-utils'

const secretKey = loadSovbitLiveTestSecretKey()

describe.runIf(secretKey != null)('Sovbit relay live read/write (SCRIPTORIUM_KEY)', () => {
  const sk = secretKey!

  beforeAll(() => {
    process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY = SOVBIT_RELAY_CLEARNET
    installSovbitLiveTestRelayTransport()
  })

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

  it(
    'Tor onion relay publishes and reads back (via hidden-network transport)',
    async () => {
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_TOR,
        secretKey: sk
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    120_000
  )

  it(
    'I2P b32 relay publishes and reads back (via hidden-network transport)',
    async () => {
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_I2P,
        secretKey: sk
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    120_000
  )

  it('uses IMWALD_HIDDEN_RELAY_TEST_GATEWAY for hidden-network dials', () => {
    expect(process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY).toBe(SOVBIT_RELAY_CLEARNET)
  })
})

describe.runIf(secretKey == null)('Sovbit relay live read/write (SCRIPTORIUM_KEY)', () => {
  it('skips live relay tests when SCRIPTORIUM_KEY is unset', () => {
    expect(process.env.SCRIPTORIUM_KEY?.trim()).toBeFalsy()
  })
})

describe.runIf(secretKey != null)('Sovbit relay live read/write via SOCKS (SCRIPTORIUM_KEY)', () => {
  const sk = secretKey!

  beforeAll(() => {
    delete process.env.IMWALD_HIDDEN_RELAY_TEST_GATEWAY
    installSovbitLiveTestRelayTransport()
  })

  it(
    'Tor onion relay publishes and reads back through local SOCKS',
    async ({ skip }) => {
      const { tor } = await localHiddenNetworkSocksAvailability()
      if (!tor) skip()
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_TOR,
        secretKey: sk
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    180_000
  )

  it(
    'I2P b32 relay publishes and reads back through local SOCKS',
    async ({ skip }) => {
      const { i2p } = await localHiddenNetworkSocksAvailability()
      if (!i2p) skip()
      const { eventId } = await relayReadWriteRoundTrip({
        relayUrl: SOVBIT_RELAY_I2P,
        secretKey: sk
      })
      expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    },
    180_000
  )
})
