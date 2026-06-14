/**
 * Live Sovbit relay round-trip helpers (clearnet / Tor / I2P).
 * Used by {@link ./sovbit-relay-live.integration.test.ts} — not imported from app runtime.
 */
import WebSocket from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { finalizeEvent, nip19 } from 'nostr-tools'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import type { EventTemplate } from 'nostr-tools'

export const SOVBIT_RELAY_CLEARNET = 'wss://relay.sovbit.host'
export const SOVBIT_RELAY_TOR =
  'ws://cwx3zhyyu3x64b7u5xj63toy56eyo35ohzsaxjs5ko2ackpapqi3qhyd.onion:7778'
export const SOVBIT_RELAY_I2P =
  'ws://hfv334dgnndidbgdi2rbbvrtimp2fqy5unpys5tumixhrr7gi2sa.b32.i2p:7778'

export const DEFAULT_TOR_SOCKS = 'socks5://127.0.0.1:9050'
export const DEFAULT_I2P_SOCKS = 'socks5://127.0.0.1:7657'

export type SovbitRelayEndpoint = {
  label: 'clearnet' | 'tor' | 'i2p'
  url: string
  /** When set, WebSocket connects through this SOCKS proxy (Tor / I2P router). */
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

function createWebSocketViaSocks(socksProxyUrl: string): typeof WebSocket {
  const agent = new SocksProxyAgent(socksProxyUrl)
  class SocksWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { agent })
    }
  }
  return SocksWebSocket as unknown as typeof WebSocket
}

export function installRelayWebSocketTransport(socksProxyUrl?: string): void {
  useWebSocketImplementation(
    socksProxyUrl ? createWebSocketViaSocks(socksProxyUrl) : (WebSocket as unknown as typeof globalThis.WebSocket)
  )
}

export async function probeRelayConnection(
  relayUrl: string,
  opts?: { socksProxyUrl?: string; timeoutMs?: number }
): Promise<boolean> {
  installRelayWebSocketTransport(opts?.socksProxyUrl)
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
  installRelayWebSocketTransport(opts.socksProxyUrl)
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
