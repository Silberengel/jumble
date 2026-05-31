import { describe, expect, it, beforeEach } from 'vitest'
import { isRelayStrikeEntryActive, relaySessionStrikes } from './relay-strikes'
import type { RelayOpTerminalRow } from '@/services/relay-operation-log.service'

function row(
  url: string,
  outcome: RelayOpTerminalRow['outcome'],
  msFromBatchStart: number
): RelayOpTerminalRow {
  return { cmdIndex: 0, relayUrl: url, outcome, msFromBatchStart }
}

describe('relaySessionStrikes.observeSubscribeBatch', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
  })

  it('session-parks a relay much slower than batch median after two slow waves', () => {
    const slow = 'wss://slow.example.com/'
    const fast = 'wss://fast.example.com/'

    relaySessionStrikes.observeSubscribeBatch([
      row(fast, 'eose', 400),
      row(slow, 'eose', 12_000)
    ])
    expect(relaySessionStrikes.isReadHttpSkipped(slow)).toBe(false)

    relaySessionStrikes.observeSubscribeBatch([
      row(fast, 'eose', 500),
      row(slow, 'eose', 11_000)
    ])
    expect(relaySessionStrikes.isReadHttpSkipped(slow)).toBe(true)
    expect(relaySessionStrikes.isReadHttpSkipped(fast)).toBe(false)
  })

  it('does not session-park read-only index relays (e.g. aggr.nostr.land)', () => {
    const aggr = 'wss://aggr.nostr.land/'
    const fast = 'wss://fast.example.com/'

    relaySessionStrikes.observeSubscribeBatch([
      row(fast, 'eose', 400),
      row(aggr, 'eose', 12_000)
    ])
    relaySessionStrikes.observeSubscribeBatch([
      row(fast, 'eose', 500),
      row(aggr, 'timeout', 10_000)
    ])
    expect(relaySessionStrikes.isReadHttpSkipped(aggr)).toBe(false)
  })

  it('clears slow parking on fast EOSE via recordReadSuccess', () => {
    const url = 'wss://recover.example.com/'
    relaySessionStrikes.observeSubscribeBatch([row(url, 'eose', 15_000)])
    relaySessionStrikes.observeSubscribeBatch([row(url, 'eose', 14_000)])
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    relaySessionStrikes.recordReadSuccess(url)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
  })
})

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

describe('isRelayStrikeEntryActive', () => {
  it('is false for empty entry', () => {
    expect(
      isRelayStrikeEntryActive({
        readFailures: 0,
        readLastStrikeIncrementAt: 0,
        readStrikeSkipUntil: 0,
        slowSignals: 0,
        slowParkUntil: 0,
        publishFailures: 0,
        publishLastStrikeIncrementAt: 0,
        publishStrikeSkipUntil: 0,
        rateLimitUntil: 0
      })
    ).toBe(false)
  })
})
