import { describe, expect, it } from 'vitest'
import {
  mergeAccountSecrets,
  mergeAccountsSettingsJson,
  mergeCurrentAccountSettingsJson
} from './account-secrets'
import type { TAccount } from '@/types'

describe('mergeAccountSecrets', () => {
  it('fills missing nsec from fallback', () => {
    const primary: TAccount = { pubkey: 'aa'.repeat(32), signerType: 'nsec' }
    const fallback: TAccount = {
      pubkey: 'aa'.repeat(32),
      signerType: 'nsec',
      nsec: 'nsec1test'
    }
    expect(mergeAccountSecrets(primary, fallback).nsec).toBe('nsec1test')
  })

  it('keeps primary nsec when present', () => {
    const primary: TAccount = {
      pubkey: 'aa'.repeat(32),
      signerType: 'nsec',
      nsec: 'nsec1primary'
    }
    const fallback: TAccount = {
      pubkey: 'aa'.repeat(32),
      signerType: 'nsec',
      nsec: 'nsec1fallback'
    }
    expect(mergeAccountSecrets(primary, fallback).nsec).toBe('nsec1primary')
  })
})

describe('mergeAccountsSettingsJson', () => {
  const hex = 'aa'.repeat(32)
  const withSecret: TAccount = { pubkey: hex, signerType: 'nsec', nsec: 'nsec1stored' }
  const withoutSecret: TAccount = { pubkey: hex, signerType: 'nsec' }

  it('restores nsec from localStorage when IndexedDB row lacks it', () => {
    const merged = mergeAccountsSettingsJson(
      JSON.stringify([withoutSecret]),
      JSON.stringify([withSecret])
    )
    expect(JSON.parse(merged!)[0].nsec).toBe('nsec1stored')
  })

  it('adds accounts present only in localStorage', () => {
    const merged = mergeAccountsSettingsJson(JSON.stringify([]), JSON.stringify([withSecret]))
    expect(JSON.parse(merged!)).toHaveLength(1)
  })
})

describe('mergeCurrentAccountSettingsJson', () => {
  const hex = 'aa'.repeat(32)

  it('merges secrets for the same account pointer', () => {
    const merged = mergeCurrentAccountSettingsJson(
      JSON.stringify({ pubkey: hex, signerType: 'nsec' }),
      JSON.stringify({ pubkey: hex, signerType: 'nsec', nsec: 'nsec1stored' })
    )
    expect(JSON.parse(merged!).nsec).toBe('nsec1stored')
  })
})
