import type { Event } from 'nostr-tools'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { isRelayPublishPolicyRejection } from '@/lib/relay-publish-filter'
import { canonicalRelaySessionKey, httpIndexRelayBasesInUrlBatch, isLocalNetworkUrl } from '@/lib/url'

/** Conservative: 5 read/publish failures → skip until this many ms after last qualifying failure. */
const STRIKE_FAILURES_THRESHOLD = 5
/** Kind 10432 cache relays (often localhost): skip after fewer failures — no point hammering a dead socket. */
const CACHE_RELAY_STRIKE_FAILURES_THRESHOLD = 2
/** LAN / loopback WS: same fast skip on connection refused. */
const LOCAL_NETWORK_STRIKE_FAILURES_THRESHOLD = 2
const STRIKE_COOLDOWN_MS = 3 * 60 * 1000
/** Each further strike round doubles the cooldown (3 → 6 → 12 min …) up to this cap. */
const MAX_STRIKE_COOLDOWN_MS = 30 * 60 * 1000

/** Rate-limit style NOTICE / overload → cool down without incrementing strike counter. */
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000
/** HTTP 429 on WebSocket handshake: shorter backoff so explicit relay browse recovers after accidental hammering. */
const CONNECTION_RATE_LIMIT_COOLDOWN_MS = 90 * 1000

/** Non–cache-relay failures: at most one strike increment per key per this window. */
const STRIKE_INCREMENT_DEBOUNCE_MS = 30 * 1000

export type RelayNoticeClass = 'rate_limit' | 'fetch_failed' | 'neutral'

const RATE_LIMIT_RE =
  /too many concurrent|concurrent req|rate[\s-]*limit|overloaded|429|slow down|throttl|backoff|try again later|maximum\s+subscriptions|noting too much/i

const FETCH_FAILED_RE = /failed to fetch events/i

export function classifyRelayNotice(message: string): RelayNoticeClass {
  const m = message.toLowerCase()
  if (RATE_LIMIT_RE.test(m)) return 'rate_limit'
  if (FETCH_FAILED_RE.test(m)) return 'fetch_failed'
  return 'neutral'
}

type StrikeEntry = {
  readFailures: number
  readLastStrikeIncrementAt: number
  readStrikeSkipUntil: number
  /** How many strike rounds this relay went through without a success (escalates the cooldown). */
  readStrikeLevel: number
  publishFailures: number
  publishLastStrikeIncrementAt: number
  publishStrikeSkipUntil: number
  rateLimitUntil: number
}

export type RelayStrikeDebugSnapshot = {
  entries: { key: string; entry: StrikeEntry; cacheRelay: boolean }[]
  cacheRelayKeys: string[]
}

/** True when the relay is skipped or has accrued session strike / cooldown state. */
export function isRelayStrikeEntryActive(entry: StrikeEntry, now = Date.now()): boolean {
  if (entry.readFailures > 0 || entry.publishFailures > 0) return true
  if (now < entry.readStrikeSkipUntil) return true
  if (now < entry.publishStrikeSkipUntil) return true
  if (now < entry.rateLimitUntil) return true
  return false
}

function emptyEntry(): StrikeEntry {
  return {
    readFailures: 0,
    readLastStrikeIncrementAt: 0,
    readStrikeSkipUntil: 0,
    readStrikeLevel: 0,
    publishFailures: 0,
    publishLastStrikeIncrementAt: 0,
    publishStrikeSkipUntil: 0,
    rateLimitUntil: 0
  }
}

function sessionKey(url: string): string {
  return canonicalRelaySessionKey(url)
}

/**
 * Session-only relay health: strikes (skip after N failures), rate-limit cooldown (no strike),
 * and optional “cache relay” URLs from kind 10432 (always count failures, no debounce).
 */
class RelaySessionStrikes {
  private byKey = new Map<string, StrikeEntry>()
  private cacheRelayKeys = new Set<string>()
  private changeListeners = new Set<() => void>()

  /** Subscribe to session strike map changes (for relay icon UI). */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener()
    }
  }

  /** True when this URL has session strike / cooldown state (see {@link isRelayStrikeEntryActive}). */
  isSessionStrikeActiveForUrl(url: string, now = Date.now()): boolean {
    const key = sessionKey(url)
    if (!key) return false
    const e = this.byKey.get(key)
    if (!e) return false
    return isRelayStrikeEntryActive(e, now)
  }

  setSessionCacheRelayKeysFromKind10432(ev: Event | null | undefined): void {
    this.cacheRelayKeys.clear()
    if (!ev?.tags?.length) return
    const list = getRelayListFromEvent(ev)
    const add = (u: string) => {
      const k = sessionKey(u)
      if (k) this.cacheRelayKeys.add(k)
    }
    for (const u of list.read) add(u)
    for (const u of list.write) add(u)
    for (const r of list.originalRelays ?? []) {
      if (r.url) add(r.url)
    }
    for (const u of list.httpRead ?? []) add(u)
    for (const u of list.httpWrite ?? []) add(u)
  }

  isCacheRelayKeyForUrl(url: string): boolean {
    const k = sessionKey(url)
    return !!k && this.cacheRelayKeys.has(k)
  }

  private getEntry(key: string): StrikeEntry {
    let e = this.byKey.get(key)
    if (!e) {
      e = emptyEntry()
      this.byKey.set(key, e)
    }
    return e
  }

  /** True when a relay NOTICE or connection error put this URL in rate-limit cooldown. */
  isRateLimited(url: string): boolean {
    const key = sessionKey(url)
    if (!key) return false
    const e = this.byKey.get(key)
    if (!e) return false
    return Date.now() < e.rateLimitUntil
  }

  /** True when read / WS / HTTP index fetch should omit this relay (unless single-relay override). */
  isReadHttpSkipped(url: string): boolean {
    const key = sessionKey(url)
    if (!key) return false
    const e = this.byKey.get(key)
    if (!e) return false
    return Date.now() < Math.max(e.rateLimitUntil, e.readStrikeSkipUntil)
  }

  /** WS/HTTP connect failure: rate-limit style errors cool down without accruing read strikes. */
  recordConnectionFailure(url: string, message: string, source: 'connection' | 'http' = 'connection'): void {
    if (classifyRelayNotice(message) === 'rate_limit') {
      if (source === 'connection') {
        this.applyConnectionRateLimitCooldownForUrl(url)
      } else {
        this.applyRateLimitCooldownForUrl(url)
      }
      return
    }
    this.recordReadFailure(url, source)
  }

  /** True when publish should omit this relay (unless single-target override). */
  isPublishSkipped(url: string): boolean {
    const key = sessionKey(url)
    if (!key) return false
    const e = this.byKey.get(key)
    if (!e) return false
    return Date.now() < Math.max(e.rateLimitUntil, e.publishStrikeSkipUntil)
  }

  handleNotice(relayKeyRaw: string, message: string): void {
    const key = sessionKey(relayKeyRaw)
    if (!key) return
    const kind = classifyRelayNotice(message)
    if (kind === 'rate_limit') {
      this.applyRateLimitCooldownKey(key)
      return
    }
    if (kind === 'fetch_failed') {
      this.recordReadFailureKey(key, 'notice')
    }
  }

  applyRateLimitCooldownForUrl(url: string): void {
    const key = sessionKey(url)
    if (key) this.applyRateLimitCooldownKey(key, RATE_LIMIT_COOLDOWN_MS)
  }

  applyConnectionRateLimitCooldownForUrl(url: string): void {
    const key = sessionKey(url)
    if (key) this.applyRateLimitCooldownKey(key, CONNECTION_RATE_LIMIT_COOLDOWN_MS)
  }

  private applyRateLimitCooldownKey(key: string, cooldownMs = RATE_LIMIT_COOLDOWN_MS): void {
    const e = this.getEntry(key)
    e.rateLimitUntil = Math.max(e.rateLimitUntil, Date.now() + cooldownMs)
    this.emitChange()
  }

  /** WS connect failure, HTTP transport failure, etc. */
  recordReadFailure(url: string, source: 'connection' | 'notice' | 'http'): void {
    const key = sessionKey(url)
    if (!key) return
    this.recordReadFailureKey(key, source, url)
  }

  private recordReadFailureKey(
    key: string,
    source: 'connection' | 'notice' | 'http',
    urlForLocalCheck?: string
  ): void {
    const now = Date.now()
    const e = this.getEntry(key)
    // During rate-limit cooldown, do not add strikes for normal relays (relay can catch up).
    // Cache relays from kind 10432 (e.g. localhost on another machine) always accrue failures.
    if (now < e.rateLimitUntil && !this.cacheRelayKeys.has(key)) return

    if (!this.cacheRelayKeys.has(key)) {
      // HTTP index failures often arrive in parallel; count each so session skip engages quickly.
      // Connection refused / unreachable: do not debounce — profile feeds open many relays at once.
      if (
        source !== 'http' &&
        source !== 'connection' &&
        now - e.readLastStrikeIncrementAt < STRIKE_INCREMENT_DEBOUNCE_MS
      ) {
        return
      }
      e.readLastStrikeIncrementAt = now
    }

    e.readFailures += 1
    const threshold = this.readStrikeThresholdForKey(key, source, urlForLocalCheck)
    if (e.readFailures >= threshold) {
      // Exponential backoff: each strike round without a success doubles the cooldown (capped),
      // so a relay that stays dead gets probed less and less often instead of every 3 minutes.
      const cooldownMs = Math.min(
        STRIKE_COOLDOWN_MS * 2 ** e.readStrikeLevel,
        MAX_STRIKE_COOLDOWN_MS
      )
      e.readStrikeLevel += 1
      e.readStrikeSkipUntil = Math.max(e.readStrikeSkipUntil, now + cooldownMs)
      logger.debug('[RelayStrikes] read path strike skip', {
        key,
        readFailures: e.readFailures,
        threshold,
        strikeLevel: e.readStrikeLevel,
        cooldownMs
      })
    }
    this.emitChange()
  }

  private readStrikeThresholdForKey(
    key: string,
    source: 'connection' | 'notice' | 'http',
    urlForLocalCheck?: string
  ): number {
    if (this.cacheRelayKeys.has(key)) return CACHE_RELAY_STRIKE_FAILURES_THRESHOLD
    if (source === 'connection' && urlForLocalCheck && isLocalNetworkUrl(urlForLocalCheck)) {
      return LOCAL_NETWORK_STRIKE_FAILURES_THRESHOLD
    }
    return STRIKE_FAILURES_THRESHOLD
  }

  recordReadSuccess(url: string): void {
    const key = sessionKey(url)
    if (!key) return
    const e = this.byKey.get(key)
    if (!e) return
    e.readFailures = 0
    e.readStrikeSkipUntil = 0
    e.readStrikeLevel = 0
    e.readLastStrikeIncrementAt = 0
    this.emitChange()
  }

  private publishStrikeThresholdForKey(key: string, url: string): number {
    if (this.cacheRelayKeys.has(key)) return CACHE_RELAY_STRIKE_FAILURES_THRESHOLD
    if (isLocalNetworkUrl(url)) return LOCAL_NETWORK_STRIKE_FAILURES_THRESHOLD
    return STRIKE_FAILURES_THRESHOLD
  }

  recordPublishFailure(url: string, errorMessage?: string): void {
    if (errorMessage) {
      if (isRelayPublishPolicyRejection(errorMessage)) return
      if (classifyRelayNotice(errorMessage) === 'rate_limit') {
        this.applyRateLimitCooldownForUrl(url)
        return
      }
    }
    const key = sessionKey(url)
    if (!key) return
    const now = Date.now()
    const e = this.getEntry(key)
    if (now < e.rateLimitUntil && !this.cacheRelayKeys.has(key)) return
    const isCacheRelay = this.cacheRelayKeys.has(key)
    const isLocalPublish = isLocalNetworkUrl(url)
    if (!isCacheRelay && !isLocalPublish) {
      if (now - e.publishLastStrikeIncrementAt < STRIKE_INCREMENT_DEBOUNCE_MS) return
      e.publishLastStrikeIncrementAt = now
    }
    e.publishFailures += 1
    const threshold = this.publishStrikeThresholdForKey(key, url)
    if (e.publishFailures >= threshold) {
      e.publishStrikeSkipUntil = Math.max(e.publishStrikeSkipUntil, now + STRIKE_COOLDOWN_MS)
      logger.warn('[RelayStrikes] publish path strike skip', { key, publishFailures: e.publishFailures, threshold })
    }
    this.emitChange()
  }

  /** Successful publish clears publish strikes (existing publish stats stay in ClientService). */
  recordPublishSuccess(url: string): void {
    const key = sessionKey(url)
    if (!key) return
    const e = this.byKey.get(key)
    if (!e) return
    e.publishFailures = 0
    e.publishStrikeSkipUntil = 0
    e.publishLastStrikeIncrementAt = 0
    this.emitChange()
  }

  filterPublishUrls(urls: readonly string[]): string[] {
    if (urls.length <= 1) return [...urls]
    const out = urls.filter((u) => !this.isPublishSkipped(u))
    return out.length > 0 ? out : [...urls]
  }

  filterReadHttpUrls(urls: readonly string[], httpIndexBases: readonly string[] = []): string[] {
    const http = httpIndexRelayBasesInUrlBatch(urls, httpIndexBases)
    const httpKeys = new Set(http.map((u) => canonicalRelaySessionKey(u)))
    const ws = urls.filter((u) => !httpKeys.has(canonicalRelaySessionKey(u)))
    const wsOut = ws.filter((u) => !this.isReadHttpSkipped(u))
    const httpOut = http.filter((u) => !this.isReadHttpSkipped(u))
    const merged = [...wsOut, ...httpOut]
    return merged.length > 0 ? merged : [...urls]
  }

  getDebugSnapshot(): RelayStrikeDebugSnapshot {
    return {
      entries: Array.from(this.byKey.entries()).map(([key, entry]) => ({
        key,
        entry: { ...entry },
        cacheRelay: this.cacheRelayKeys.has(key)
      })),
      cacheRelayKeys: Array.from(this.cacheRelayKeys)
    }
  }

  /** Remove session strike / cooldown state for one relay (settings “free relay”). */
  clearKey(urlOrSessionKey: string): void {
    const key = sessionKey(urlOrSessionKey) || urlOrSessionKey.trim()
    if (!key) return
    this.byKey.delete(key)
    this.emitChange()
  }

  reset(): void {
    this.byKey.clear()
    this.cacheRelayKeys.clear()
    this.emitChange()
  }
}

export const relaySessionStrikes = new RelaySessionStrikes()

/** Distinct hosts that must fail within {@link BREAKER_WINDOW_MS} before the global breaker trips. */
const BREAKER_DISTINCT_HOST_THRESHOLD = 8
/** Sliding window for counting distinct failing hosts. */
const BREAKER_WINDOW_MS = 30 * 1000
/** First pause once tripped; doubles per consecutive trip without a success. */
const BREAKER_INITIAL_PAUSE_MS = 15 * 1000
const BREAKER_MAX_PAUSE_MS = 5 * 60 * 1000

/**
 * Global “network is probably down” circuit breaker.
 *
 * `navigator.onLine` misses many real outage shapes (captive portals, dead Wi-Fi uplink, VPN drop),
 * during which every relay in the pool fails and per-relay strikes each still allow several retries.
 * When many *distinct* hosts fail in a short window, this pauses all new non-local connection
 * attempts, with exponential backoff until one connection succeeds again.
 */
export class RelayConnectivityBreaker {
  /** host → last failure timestamp within the current window. */
  private failedHosts = new Map<string, number>()
  private pausedUntil = 0
  /** Consecutive trips without an intervening success (escalates the pause). */
  private tripLevel = 0

  private hostOf(url: string): string | null {
    try {
      return new URL(url).host || null
    } catch {
      return null
    }
  }

  /** True while new (non-local) connection attempts should be skipped. */
  isPaused(now = Date.now()): boolean {
    return now < this.pausedUntil
  }

  recordFailure(url: string, now = Date.now()): void {
    if (isLocalNetworkUrl(url)) return
    const host = this.hostOf(url)
    if (!host) return
    this.failedHosts.set(host, now)
    for (const [h, t] of this.failedHosts) {
      if (now - t > BREAKER_WINDOW_MS) this.failedHosts.delete(h)
    }
    if (this.isPaused(now)) return
    if (this.failedHosts.size < BREAKER_DISTINCT_HOST_THRESHOLD) return
    const pauseMs = Math.min(BREAKER_INITIAL_PAUSE_MS * 2 ** this.tripLevel, BREAKER_MAX_PAUSE_MS)
    this.tripLevel += 1
    this.pausedUntil = now + pauseMs
    this.failedHosts.clear()
    logger.warn('[RelayConnectivityBreaker] widespread connection failures — pausing new relay connections', {
      distinctHosts: BREAKER_DISTINCT_HOST_THRESHOLD,
      pauseMs,
      tripLevel: this.tripLevel
    })
  }

  /** Any successful relay connection proves the network works: fully reset. */
  recordSuccess(): void {
    if (this.tripLevel === 0 && this.failedHosts.size === 0 && this.pausedUntil === 0) return
    this.failedHosts.clear()
    this.pausedUntil = 0
    this.tripLevel = 0
  }

  reset(): void {
    this.recordSuccess()
  }
}

export const relayConnectivityBreaker = new RelayConnectivityBreaker()
