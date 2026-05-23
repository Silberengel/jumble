import { describe, expect, it } from 'vitest'
import { getPow } from 'nostr-tools/nip13'
import { minePow } from '@/lib/event'

describe('minePow', () => {
  it('uses NIP-13 nonce tag and meets requested difficulty', async () => {
    const unsigned = {
      kind: 1,
      content: 'pow test',
      tags: [] as string[][],
      created_at: 1_700_000_000,
      pubkey: 'a'.repeat(64)
    }
    const mined = await minePow(unsigned, 1)
    expect(unsigned.tags).toEqual([])
    expect(mined.tags.some((t) => t[0] === 'nonce' && t[2] === '1')).toBe(true)
    expect(getPow(mined.id)).toBeGreaterThanOrEqual(1)
  })
})
