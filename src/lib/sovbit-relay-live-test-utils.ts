/**
 * Live Sovbit relay round-trip helpers (clearnet / Tor / I2P).
 * Uses {@link installNodeHiddenNetworkRelayWebSocket} from the app transport layer.
 */
import { finalizeEvent, nip19 } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import type { EventTemplate } from 'nostr-tools'
import { resolveHiddenNetworkRelayConnectPlan } from '@/lib/hidden-network-relay'
import { installNodeHiddenNetworkRelayWebSocket } from '@/lib/hidden-network-relay.node'

export {
  DEFAULT_I2P_SOCKS_URL as DEFAULT_I2P_SOCKS,
  DEFAULT_TOR_SOCKS_URL as DEFAULT_TOR_SOCKS
} from '@/lib/hidden-network-relay'

export const SOVBIT_RELAY_CLEARNET = 'wss://relay.sovbit.host'
export const SOVBIT_RELAY_TOR =
  'ws://cwx3zhyyu3x64b7u5xj63toy56eyo35ohzsaxjs5ko2ackpapqi3qhyd.onion:7778'
export const SOVBIT_RELAY_I2P =
  'ws://hfv334dgnndidbgdi2rbbvrtimp2fqy5unpys5tumixhrr7gi2sa.b32.i2p:7778'

export type SovbitRelayEndpoint = {
  label: 'clearnet' | 'tor' | 'i2p'
  url: string
  socksProxyUrl?: string
}

export function loadSovbitLiveTestSecretKey(): Uint8Array | null {
  const raw = process.env.SCRIPTORIUM_KEY?.trim()
  if (!raw) return null
  const { type, data } = nip19.decode(raw)
  if (type !== 'nsec' || !(data instanceof Uint8Array)) {
    throw new Error('SCRIPTORIUM_KEY must be a bech32 nsec')
  }
  return data
}

export function installSovbitLiveTestRelayTransport(): void {
  installNodeHiddenNetworkRelayWebSocket()
}

export async function probeRelayConnection(
  relayUrl: string,
  opts?: { socksProxyUrl?: string; timeoutMs?: number }
): Promise<boolean> {
  if (opts?.socksProxyUrl) {
    const kind = relayUrl.includes('.onion') ? 'IMWALD_TOR_SOCKS' : 'IMWALD_I2P_SOCKS'
    process.env[kind] = opts.socksProxyUrl
  }
  installSovbitLiveTestRelayTransport()
  const pool = new SimplePool({ enableReconnect: false })
  try {
    await pool.ensureRelay(relayUrl, { connectionTimeout: opts?.timeoutMs ?? 15_000 })
    return true
  } catch {
    return false
  } finally {
    pool.destroy()
  }
}

/** Publish a signed kind-1 test note and read it back on the same relay URL. */
export async function relayReadWriteRoundTrip(opts: {
  relayUrl: string
  secretKey: Uint8Array
  socksProxyUrl?: string
  connectionTimeoutMs?: number
  queryWaitMs?: number
}): Promise<{ eventId: string; content: string }> {
  if (opts.socksProxyUrl) {
    const envKey = opts.relayUrl.includes('.onion') ? 'IMWALD_TOR_SOCKS' : 'IMWALD_I2P_SOCKS'
    process.env[envKey] = opts.socksProxyUrl
  }
  installSovbitLiveTestRelayTransport()

  const plan = resolveHiddenNetworkRelayConnectPlan(opts.relayUrl)
  if (plan.viaTestGateway) {
    // Gateway mode: logical onion/i2p URL, dial clearnet gateway (same Sovbit backend).
  }

  const pool = new SimplePool({ enableReconnect: false })
  const connectionTimeout = opts.connectionTimeoutMs ?? 45_000
  const queryWaitMs = opts.queryWaitMs ?? 20_000

  try {
    await pool.ensureRelay(opts.relayUrl, { connectionTimeout })

    const content = `imwald sovbit live test ${Date.now()}`
    const template: EventTemplate = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'imwald-live-test']],
      content
    }
    const signed = finalizeEvent(template, opts.secretKey)

    const publishSettled = await Promise.allSettled(
      pool.publish([opts.relayUrl], signed, {
        maxWait: connectionTimeout,
        onauth: async (authTemplate) => finalizeEvent(authTemplate, opts.secretKey)
      })
    )
    for (const outcome of publishSettled) {
      if (outcome.status === 'rejected') {
        throw new Error(`publish failed on ${opts.relayUrl}: ${String(outcome.reason)}`)
      }
      const result = outcome.value
      if (typeof result === 'string' && result.startsWith('connection failure:')) {
        throw new Error(`publish failed on ${opts.relayUrl}: ${result}`)
      }
    }

    const fetched = await pool.get([opts.relayUrl], { ids: [signed.id] }, { maxWait: queryWaitMs })
    if (!fetched || fetched.id !== signed.id) {
      throw new Error(`event ${signed.id} not returned by REQ on ${opts.relayUrl}`)
    }
    if (fetched.content !== content) {
      throw new Error('fetched event content mismatch')
    }

    return { eventId: signed.id, content }
  } finally {
    pool.destroy()
  }
}
