import { describe, expect, it } from 'vitest'
import {
  filterPubkeysByListSearch,
  profileMatchesListSearch,
  pubkeyMatchesListSearch
} from './filter-pubkeys-by-profile-search'
import type { TProfile } from '@/types'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

describe('pubkeyMatchesListSearch', () => {
  it('matches hex pubkey prefix', () => {
    expect(pubkeyMatchesListSearch(PK_A, PK_A.slice(0, 8))).toBe(true)
    expect(pubkeyMatchesListSearch(PK_B, PK_A.slice(0, 8))).toBe(false)
  })
})

describe('profileMatchesListSearch', () => {
  it('matches display name and nip05', () => {
    const profile: TProfile = {
      pubkey: PK_A,
      npub: 'npub1test',
      username: 'Alice Display',
      original_username: 'Alice Display',
      nip05: 'alice@example.com'
    }
    expect(profileMatchesListSearch(profile, 'alice')).toBe(true)
    expect(profileMatchesListSearch(profile, 'example.com')).toBe(true)
    expect(profileMatchesListSearch(profile, 'bob')).toBe(false)
  })
})

describe('filterPubkeysByListSearch', () => {
  it('returns only exact pubkey when query decodes to hex', () => {
    const out = filterPubkeysByListSearch([PK_A, PK_B], new Map(), PK_A)
    expect(out).toEqual([PK_A])
  })
})
