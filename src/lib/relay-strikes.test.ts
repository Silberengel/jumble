import { describe, expect, it } from 'vitest'
import {
  classifyRelayNotice,
  isRelayStrikeEntryActive,
  relaySessionStrikes
} from '@/lib/relay-strikes'

describe('classifyRelayNotice', () => {
  it('detects rate-limit style notices', () => {
    expect(classifyRelayNotice('rate-limited: you are noting too much')).toBe('rate_limit')
    expect(classifyRelayNotice('failed to fetch events')).toBe('fetch_failed')
    expect(classifyRelayNotice('hello')).toBe('neutral')
  })
})

describe('relaySessionStrikes (parking removed)', () => {
  it('never skips publish or read URLs', () => {
    const url = 'wss://relay.example/'
    for (let i = 0; i < 20; i++) {
      relaySessionStrikes.recordPublishFailure(url, 'connection failed')
      relaySessionStrikes.recordReadFailure(url, 'http')
      relaySessionStrikes.recordConnectionFailure(url, 'HTTP/1.1 429 Too Many Requests')
    }
    expect(relaySessionStrikes.isPublishSkipped(url)).toBe(false)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
    expect(relaySessionStrikes.isRateLimited(url)).toBe(false)
    expect(relaySessionStrikes.isSessionStrikeActiveForUrl(url)).toBe(false)
    expect(relaySessionStrikes.filterPublishUrls([url, 'wss://other.example/'])).toEqual([
      url,
      'wss://other.example/'
    ])
    expect(relaySessionStrikes.filterReadHttpUrls([url])).toEqual([url])
  })
})

describe('isRelayStrikeEntryActive', () => {
  it('is always false after parking removal', () => {
    expect(
      isRelayStrikeEntryActive({
        readFailures: 99,
        readLastStrikeIncrementAt: 0,
        readStrikeSkipUntil: Date.now() + 60_000,
        readStrikeLevel: 3,
        publishFailures: 99,
        publishLastStrikeIncrementAt: 0,
        publishStrikeSkipUntil: Date.now() + 60_000,
        rateLimitUntil: Date.now() + 60_000
      })
    ).toBe(false)
  })
})
