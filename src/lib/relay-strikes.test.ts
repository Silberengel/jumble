import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isRelayStrikeEntryActive,
  RelayConnectivityBreaker,
  relaySessionStrikes
} from './relay-strikes'

describe('relaySessionStrikes HTTP read failures', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('session-skips after five parallel HTTP failures (no debounce)', () => {
    const url = 'https://index.example.com/'
    for (let i = 0; i < 5; i++) {
      relaySessionStrikes.recordReadFailure(url, 'http')
    }
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
  })
})

describe('relaySessionStrikes cache and localhost', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('session-skips cache relay after two connection failures', () => {
    const url = 'ws://localhost:4869/'
    relaySessionStrikes.setSessionCacheRelayKeysFromKind10432({
      kind: 10432,
      tags: [['relay', url]],
      content: '',
      created_at: 1,
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128)
    })
    relaySessionStrikes.recordReadFailure(url, 'connection')
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
    relaySessionStrikes.recordReadFailure(url, 'connection')
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
  })

  it('session-skips localhost after two publish failures', () => {
    const url = 'ws://localhost:4869/'
    relaySessionStrikes.recordPublishFailure(url, 'connection failed')
    expect(relaySessionStrikes.isPublishSkipped(url)).toBe(false)
    relaySessionStrikes.recordPublishFailure(url, 'connection failed')
    expect(relaySessionStrikes.isPublishSkipped(url)).toBe(true)
  })
})

describe('relaySessionStrikes.clearKey', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('recordConnectionFailure applies rate-limit cooldown on HTTP 429', () => {
    const url = 'wss://relay.layer.systems/'
    relaySessionStrikes.recordConnectionFailure(url, 'HTTP/1.1 429 Too Many Requests')
    expect(relaySessionStrikes.isRateLimited(url)).toBe(true)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
  })

  it('removes strike state so relay is no longer skipped', () => {
    const url = 'ws://localhost:4000/'
    relaySessionStrikes.applyRateLimitCooldownForUrl(url)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    relaySessionStrikes.clearKey(url)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
    const snap = relaySessionStrikes.getDebugSnapshot()
    expect(snap.entries.find((e) => e.key.includes('localhost'))).toBeUndefined()
  })
})

describe('relaySessionStrikes publish failures', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('does not strike when relay rejects due to kind policy', () => {
    const url = 'wss://essayist.decentnewsroom.com/'
    for (let i = 0; i < 10; i++) {
      relaySessionStrikes.recordPublishFailure(
        url,
        'only published longform articles accepted on this relay (kind 30023)'
      )
    }
    expect(relaySessionStrikes.isPublishSkipped(url)).toBe(false)
  })

  it('strikes after repeated infrastructure publish failures', () => {
    const url = 'wss://relay.example.com/'
    relaySessionStrikes.recordPublishFailure(url, 'websocket closed')
    const snap = relaySessionStrikes.getDebugSnapshot()
    const entry = snap.entries.find((e) => e.key.includes('relay.example.com'))
    expect(entry?.entry.publishFailures).toBe(1)
  })

  it('applies rate-limit cooldown on publish rate-limit NOTICE instead of accruing strikes', () => {
    const url = 'wss://relay.damus.io/'
    relaySessionStrikes.recordPublishFailure(url, 'rate-limited: you are noting too much')
    expect(relaySessionStrikes.isPublishSkipped(url)).toBe(true)
    const snap = relaySessionStrikes.getDebugSnapshot()
    const entry = snap.entries.find((e) => e.key.includes('damus'))
    expect(entry?.entry.publishFailures).toBe(0)
  })
})

describe('relaySessionStrikes.isSessionStrikeActiveForUrl', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('is false with no strike state', () => {
    expect(relaySessionStrikes.isSessionStrikeActiveForUrl('wss://relay.example/')).toBe(false)
  })

  it('is true after read failures accrue', () => {
    const url = 'wss://relay.example/'
    relaySessionStrikes.recordReadFailure(url, 'http')
    expect(relaySessionStrikes.isSessionStrikeActiveForUrl(url)).toBe(true)
  })

  it('is false after clearKey', () => {
    const url = 'wss://relay.example/'
    relaySessionStrikes.recordReadFailure(url, 'http')
    relaySessionStrikes.clearKey(url)
    expect(relaySessionStrikes.isSessionStrikeActiveForUrl(url)).toBe(false)
  })
})

describe('relaySessionStrikes exponential read-strike backoff', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('doubles the skip cooldown for each strike round without a success', () => {
    const url = 'wss://dead.example.com/'
    // First strike round: 5 connection failures → 3 min cooldown.
    for (let i = 0; i < 5; i++) relaySessionStrikes.recordReadFailure(url, 'connection')
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)

    // Just past the first 3 min cooldown: relay is probeable again.
    vi.advanceTimersByTime(3 * 60 * 1000 + 1000)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)

    // Second strike round → 6 min cooldown, so 4 min later it's still skipped.
    relaySessionStrikes.recordReadFailure(url, 'connection')
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    vi.advanceTimersByTime(2 * 60 * 1000 + 1000)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
  })

  it('resets the escalation level on read success', () => {
    const url = 'wss://flaky.example.com/'
    for (let i = 0; i < 5; i++) relaySessionStrikes.recordReadFailure(url, 'connection')
    vi.advanceTimersByTime(3 * 60 * 1000 + 1000)
    relaySessionStrikes.recordReadSuccess(url)

    // After a success the next strike round is back to the base 3 min cooldown.
    for (let i = 0; i < 5; i++) relaySessionStrikes.recordReadFailure(url, 'connection')
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    vi.advanceTimersByTime(3 * 60 * 1000 + 1000)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
  })
})

describe('RelayConnectivityBreaker', () => {
  it('pauses after failures on 8 distinct hosts within the window', () => {
    const breaker = new RelayConnectivityBreaker()
    const now = 1_000_000
    for (let i = 0; i < 7; i++) {
      breaker.recordFailure(`wss://relay${i}.example.com/`, now)
    }
    expect(breaker.isPaused(now)).toBe(false)
    breaker.recordFailure('wss://relay7.example.com/', now)
    expect(breaker.isPaused(now)).toBe(true)
  })

  it('does not trip on repeated failures of the same host', () => {
    const breaker = new RelayConnectivityBreaker()
    const now = 1_000_000
    for (let i = 0; i < 20; i++) {
      breaker.recordFailure('wss://same.example.com/', now + i)
    }
    expect(breaker.isPaused(now + 20)).toBe(false)
  })

  it('ignores failures outside the 30s window', () => {
    const breaker = new RelayConnectivityBreaker()
    const start = 1_000_000
    for (let i = 0; i < 7; i++) {
      breaker.recordFailure(`wss://relay${i}.example.com/`, start)
    }
    // 31s later the earlier failures have expired; one more failure is not enough.
    breaker.recordFailure('wss://relay7.example.com/', start + 31_000)
    expect(breaker.isPaused(start + 31_000)).toBe(false)
  })

  it('ignores local network relays', () => {
    const breaker = new RelayConnectivityBreaker()
    const now = 1_000_000
    for (let i = 0; i < 20; i++) {
      breaker.recordFailure(`ws://192.168.1.${i}:4869/`, now)
    }
    expect(breaker.isPaused(now)).toBe(false)
  })

  it('escalates the pause on consecutive trips and resets on success', () => {
    const breaker = new RelayConnectivityBreaker()
    const t0 = 1_000_000
    const trip = (at: number) => {
      for (let i = 0; i < 8; i++) {
        breaker.recordFailure(`wss://relay${i}.example.com/`, at)
      }
    }
    trip(t0)
    expect(breaker.isPaused(t0 + 14_000)).toBe(true)
    expect(breaker.isPaused(t0 + 16_000)).toBe(false)

    // Second trip doubles the pause to 30s.
    trip(t0 + 16_000)
    expect(breaker.isPaused(t0 + 16_000 + 29_000)).toBe(true)
    expect(breaker.isPaused(t0 + 16_000 + 31_000)).toBe(false)

    // A successful connection fully resets — next trip pauses only 15s again.
    breaker.recordSuccess()
    trip(t0 + 60_000)
    expect(breaker.isPaused(t0 + 60_000 + 14_000)).toBe(true)
    expect(breaker.isPaused(t0 + 60_000 + 16_000)).toBe(false)
  })
})

describe('isRelayStrikeEntryActive', () => {
  it('is false for empty entry', () => {
    expect(
      isRelayStrikeEntryActive({
        readFailures: 0,
        readLastStrikeIncrementAt: 0,
        readStrikeSkipUntil: 0,
        readStrikeLevel: 0,
        publishFailures: 0,
        publishLastStrikeIncrementAt: 0,
        publishStrikeSkipUntil: 0,
        rateLimitUntil: 0
      })
    ).toBe(false)
  })
})
