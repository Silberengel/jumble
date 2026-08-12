import { RELAY_POOL_IDLE_SWEEP_INTERVAL_MS, RELAY_POOL_SOCKET_IDLE_MS } from '@/constants'
import { isMetadataPolicyProfileRelay } from '@/lib/metadata-policy-curated-relays'
import { isRelayUrlInViewerMetadataLists } from '@/lib/read-only-relay-personal'
import logger from '@/lib/logger'
import { canonicalRelaySessionKey, normalizeAnyRelayUrl } from '@/lib/url'
import type { SimplePool } from 'nostr-tools'

type HasActiveSubsFn = (canonicalRelayKey: string) => boolean

let pool: SimplePool | null = null
let hasActiveSubs: HasActiveSubsFn | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null
const lastActivityMs = new Map<string, number>()

function canon(url: string): string {
  return canonicalRelaySessionKey(normalizeAnyRelayUrl(url) || url.trim())
}

function shouldKeepProfileRelaySocketOpen(url: string): boolean {
  return isMetadataPolicyProfileRelay(url)
}

/** Mark relay URL as recently used (connect, REQ, publish). */
export function touchRelayPoolActivity(url: string): void {
  const key = canon(url)
  if (!key) return
  lastActivityMs.set(key, Date.now())
}

/**
 * Wire idle socket sweeps to the app pool. Safe to call once from {@link ClientService} constructor.
 */
export function initRelayPoolIdle(nextPool: SimplePool, nextHasActiveSubs: HasActiveSubsFn): void {
  pool = nextPool
  hasActiveSubs = nextHasActiveSubs
  if (sweepTimer != null) return
  sweepTimer = setInterval(() => {
    sweepIdleRelayPoolSockets()
  }, RELAY_POOL_IDLE_SWEEP_INTERVAL_MS)
}

/** Close connected sockets that have no active SUBs and exceeded {@link RELAY_POOL_SOCKET_IDLE_MS}. */
export function sweepIdleRelayPoolSockets(): void {
  if (!pool || !hasActiveSubs) return
  const now = Date.now()
  let status: Map<string, boolean>
  try {
    status = pool.listConnectionStatus()
  } catch {
    return
  }

  const toClose: string[] = []
  for (const [url, connected] of status) {
    if (!connected) continue
    const key = canon(url)
    if (!key) continue
    if (shouldKeepProfileRelaySocketOpen(url)) continue
    if (hasActiveSubs(key)) continue
    const last = lastActivityMs.get(key) ?? 0
    if (now - last < RELAY_POOL_SOCKET_IDLE_MS) continue
    toClose.push(normalizeAnyRelayUrl(url) || url)
  }

  if (toClose.length === 0) return
  try {
    pool.close(toClose)
    logger.debug('[RelayPoolIdle] closed idle sockets', { count: toClose.length, relays: toClose })
  } catch {
    /* ignore */
  }
  for (const url of toClose) {
    lastActivityMs.delete(canon(url))
  }
}

/** Close specific relays when they are connected and have no active SUBs. */
export function closeRelayPoolSocketsIfIdle(urls: readonly string[]): void {
  if (!pool || !hasActiveSubs || urls.length === 0) return
  let status: Map<string, boolean>
  try {
    status = pool.listConnectionStatus()
  } catch {
    return
  }

  const toClose: string[] = []
  for (const raw of urls) {
    const key = canon(raw)
    if (!key || hasActiveSubs(key)) continue
    if (shouldKeepProfileRelaySocketOpen(raw)) continue
    const normalized = normalizeAnyRelayUrl(raw) || raw
    const connected = [...status.entries()].some(
      ([u, ok]) => ok && canon(u) === key
    )
    if (connected) toClose.push(normalized)
  }
  if (toClose.length === 0) return
  try {
    pool.close(toClose)
    logger.debug('[RelayPoolIdle] closed idle sockets (explicit)', { relays: toClose })
  } catch {
    /* ignore */
  }
}

/**
 * After publish: drop sockets opened for author outboxes, random NIP-66 picks, and other non-personal
 * targets. Keeps profile index relays and the viewer's own list relays connected.
 */
export function closePublishTransientRelaySockets(urls: readonly string[]): void {
  if (!pool || !hasActiveSubs || urls.length === 0) return
  let status: Map<string, boolean>
  try {
    status = pool.listConnectionStatus()
  } catch {
    return
  }

  const toClose: string[] = []
  for (const raw of urls) {
    if (isRelayUrlInViewerMetadataLists(raw)) continue
    if (isMetadataPolicyProfileRelay(raw)) continue
    const key = canon(raw)
    if (!key || hasActiveSubs(key)) continue
    const normalized = normalizeAnyRelayUrl(raw) || raw
    const connected = [...status.entries()].some(
      ([u, ok]) => ok && canon(u) === key
    )
    if (connected) toClose.push(normalized)
  }
  if (toClose.length === 0) return
  try {
    pool.close(toClose)
    logger.debug('[RelayPoolIdle] closed publish transient sockets', { relays: toClose })
  } catch {
    /* ignore */
  }
  for (const url of toClose) {
    lastActivityMs.delete(canon(url))
  }
}

export function resetRelayPoolIdleForTests(): void {
  if (sweepTimer != null) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  pool = null
  hasActiveSubs = null
  lastActivityMs.clear()
}
