import { describe, expect, it } from 'vitest'
import { isRedundantAccountPick, isSameAccount, listSwitchableAccounts } from './account'

describe('listSwitchableAccounts', () => {
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  it('returns every distinct pubkey', () => {
    const out = listSwitchableAccounts([
      { pubkey: A, signerType: 'nip-07' },
      { pubkey: B, signerType: 'nip-07' }
    ])
    expect(out).toHaveLength(2)
    expect(out.map((a) => a.pubkey).sort()).toEqual([A, B].sort())
  })

  it('prefers nip-07 over npub for the same pubkey', () => {
    const out = listSwitchableAccounts([
      { pubkey: A, signerType: 'npub' },
      { pubkey: A, signerType: 'nip-07' }
    ])
    expect(out).toEqual([{ pubkey: A, signerType: 'nip-07' }])
  })

  it('keeps first preferred signer when only npub rows exist', () => {
    const out = listSwitchableAccounts([{ pubkey: A, signerType: 'npub' }])
    expect(out).toEqual([{ pubkey: A, signerType: 'npub' }])
  })
})

describe('isSameAccount', () => {
  const A = 'a'.repeat(64)
  const Aupper = A.toUpperCase()

  it('matches pubkeys case-insensitively', () => {
    expect(
      isSameAccount({ pubkey: A, signerType: 'nip-07' }, { pubkey: Aupper, signerType: 'nip-07' })
    ).toBe(true)
  })
})

describe('isRedundantAccountPick', () => {
  const A = 'a'.repeat(64)

  it('blocks exact session row', () => {
    const row = { pubkey: A, signerType: 'nip-07' as const }
    expect(isRedundantAccountPick(row, row)).toBe(true)
  })

  it('allows nip-07 pick while session is read-only npub for same pubkey', () => {
    expect(
      isRedundantAccountPick(
        { pubkey: A, signerType: 'nip-07' },
        { pubkey: A, signerType: 'npub' }
      )
    ).toBe(false)
  })
})
