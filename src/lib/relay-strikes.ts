import type { Event } from 'nostr-tools'
import logger from '@/lib/logger'
import { isLocalNetworkUrl } from '@/lib/url'

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

/** @deprecated Session parking removed; kept for Session relays debug typing. */
export type RelayStrikeDebugSnapshot = {
  entries: never[]
  cacheRelayKeys: string[]
}

/** @deprecated Always false — session parking removed. */
export function isRelayStrikeEntryActive(_entry: unknown, _now = Date.now()): boolean {
  return false
}

/**
 * Former session strike / skip map. Parking was removed: kind/policy rejections and
 * flaky connects must not sideline relays for later publish/read attempts.
 * Methods remain as no-ops so call sites stay simple.
 */
class RelaySessionStrikes {
  private changeListeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  isSessionStrikeActiveForUrl(_url: string, _now = Date.now()): boolean {
    return false
  }

  setSessionCacheRelayKeysFromKind10432(_ev: Event | null | undefined): void {}

  isCacheRelayKeyForUrl(_url: string): boolean {
    return false
  }

  isRateLimited(_url: string): boolean {
    return false
  }

  isReadHttpSkipped(_url: string): boolean {
    return false
  }

  recordConnectionFailure(
    _url: string,
    _message: string,
    _source: 'connection' | 'http' = 'connection'
  ): void {}

  isPublishSkipped(_url: string): boolean {
    return false
  }

  handleNotice(_relayKeyRaw: string, _message: string): void {}

  applyRateLimitCooldownForUrl(_url: string): void {}

  applyConnectionRateLimitCooldownForUrl(_url: string): void {}

  recordReadFailure(_url: string, _source: 'connection' | 'notice' | 'http'): void {}

  recordReadSuccess(_url: string): void {}

  recordPublishFailure(_url: string, _errorMessage?: string): void {}

  recordPublishSuccess(_url: string): void {}

  filterPublishUrls(urls: readonly string[]): string[] {
    return [...urls]
  }

  filterReadHttpUrls(urls: readonly string[], _httpIndexBases: readonly string[] = []): string[] {
    return [...urls]
  }

  getDebugSnapshot(): RelayStrikeDebugSnapshot {
    return { entries: [], cacheRelayKeys: [] }
  }

  clearKey(_urlOrSessionKey: string): void {}

  reset(): void {}
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
 * during which every relay in the pool fails. When many *distinct* hosts fail in a short window,
 * this pauses all new non-local connection attempts, with exponential backoff until one connection
 * succeeds again.
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
