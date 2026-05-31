import { describe, expect, it } from 'vitest'
import { buildRandomPublishRelayCandidateList } from './random-publish-relay-pool'

describe('buildRandomPublishRelayCandidateList', () => {
  it('fills from fallback write relays when NIP-66 list is empty', () => {
    const candidates = buildRandomPublishRelayCandidateList({
      excludeSessionKeys: new Set(['wss://relay.user.example']),
      sessionBoost: [],
      nip66Lively: [],
      fallbackWriteRelays: ['wss://alpha.example', 'wss://beta.example', 'wss://gamma.example']
    })
    expect(candidates.length).toBeGreaterThanOrEqual(3)
    expect(candidates.some((u) => u.includes('alpha.example'))).toBe(true)
    expect(candidates.some((u) => u.includes('relay.user.example'))).toBe(false)
  })

  it('dedupes session boost and NIP-66 entries', () => {
    const candidates = buildRandomPublishRelayCandidateList({
      excludeSessionKeys: new Set(),
      sessionBoost: ['wss://same.example/'],
      nip66Lively: ['wss://same.example'],
      fallbackWriteRelays: []
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatch(/same\.example/)
  })
})
