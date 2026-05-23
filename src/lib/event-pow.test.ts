import { describe, expect, it } from 'vitest'
import { getPow } from 'nostr-tools/nip13'
import { minePow } from '@/lib/event'
import {
  getEventNoncePowDifficulty,
  isEventNoncePowVerified
} from '@/lib/event-pow'

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

describe('getEventNoncePowDifficulty', () => {
  it('reads difficulty from the first verified nonce tag only', async () => {
    const unsigned = {
      kind: 1,
      content: 'pow test',
      tags: [] as string[][],
      created_at: 1_700_000_000,
      pubkey: 'a'.repeat(64)
    }
    const mined = await minePow(unsigned, 12)
    const withExtra = {
      ...mined,
      tags: [
        ...mined.tags,
        ['nonce', '999', '99'],
        ['p', 'b'.repeat(64)]
      ] as string[][]
    }
    expect(getEventNoncePowDifficulty(mined)).toBe(12)
    expect(isEventNoncePowVerified(mined)).toBe(true)
    expect(getEventNoncePowDifficulty(withExtra)).toBe(12)
  })

  it('returns null when no nonce tag', () => {
    expect(
      getEventNoncePowDifficulty({
        id: 'e'.repeat(64),
        tags: []
      })
    ).toBeNull()
  })

  it('rejects nonce tag when event id does not meet committed difficulty', async () => {
    const unsigned = {
      kind: 1,
      content: 'pow test',
      tags: [] as string[][],
      created_at: 1_700_000_000,
      pubkey: 'a'.repeat(64)
    }
    const mined = await minePow(unsigned, 5)
    const nonce = mined.tags.find((t) => t[0] === 'nonce')!
    const forged = {
      ...mined,
      tags: [['nonce', nonce[1]!, '99']] as string[][]
    }
    expect(getPow(forged.id)).toBeLessThan(99)
    expect(getEventNoncePowDifficulty(forged)).toBeNull()
    expect(isEventNoncePowVerified(forged)).toBe(false)
  })

  it('rejects nonce tag without a nonce value', () => {
    expect(
      getEventNoncePowDifficulty({
        id: '00000' + 'e'.repeat(59),
        tags: [['nonce', '', '20']]
      })
    ).toBeNull()
  })

  it('accepts when id exceeds committed difficulty (lucky hash)', () => {
    const id = '00000' + 'f'.repeat(59)
    expect(getPow(id)).toBeGreaterThanOrEqual(20)
    expect(
      getEventNoncePowDifficulty({
        id,
        tags: [['nonce', '1', '20']]
      })
    ).toBe(20)
  })
})
