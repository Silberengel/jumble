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

  it('clears slow parking on fast EOSE via recordReadSuccess', () => {
    const url = 'wss://recover.example.com/'
    relaySessionStrikes.observeSubscribeBatch([row(url, 'eose', 15_000)])
    relaySessionStrikes.observeSubscribeBatch([row(url, 'eose', 14_000)])
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(true)
    relaySessionStrikes.recordReadSuccess(url)
    expect(relaySessionStrikes.isReadHttpSkipped(url)).toBe(false)
  })
})

describe('relaySessionStrikes.clearKey', () => {
  beforeEach(() => {
    relaySessionStrikes.reset()
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
