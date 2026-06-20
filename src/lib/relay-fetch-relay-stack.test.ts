import { describe, expect, it } from 'vitest'
import { applyCapitalLetterTagRelayFallback } from '@/lib/relay-fetch-relay-stack'

describe('applyCapitalLetterTagRelayFallback', () => {
  it('returns relays unchanged when filters use lowercase tag keys', () => {
    expect(
      applyCapitalLetterTagRelayFallback(['wss://relay.example/'], { '#e': ['abc'] }, true)
    ).toEqual(['wss://relay.example/'])
  })

  it('falls back to public read relays when capital tag keys and stack is empty', () => {
    const out = applyCapitalLetterTagRelayFallback([], { '#E': ['abc'] }, true)
    expect(out.length).toBeGreaterThan(0)
  })

  it('does not fall back when offline', () => {
    expect(applyCapitalLetterTagRelayFallback([], { '#E': ['abc'] }, false)).toEqual([])
  })
})
