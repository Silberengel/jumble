import { StorageKey } from '@/constants'
import { describe, expect, it } from 'vitest'
import { mergeSettingsRecordWithLocalStorage } from './settings-storage-merge'

const SETTINGS_KEYS = [StorageKey.THEME_SETTING, StorageKey.FONT_SIZE, StorageKey.ACCOUNTS] as const

describe('mergeSettingsRecordWithLocalStorage', () => {
  it('prefers localStorage over IndexedDB for general settings', () => {
    const merged = mergeSettingsRecordWithLocalStorage(
      { [StorageKey.THEME_SETTING]: 'light', [StorageKey.FONT_SIZE]: 'medium' },
      SETTINGS_KEYS,
      (key) => (key === StorageKey.THEME_SETTING ? 'dark' : null)
    )
    expect(merged[StorageKey.THEME_SETTING]).toBe('dark')
    expect(merged[StorageKey.FONT_SIZE]).toBe('medium')
  })

  it('fills missing IndexedDB values from localStorage', () => {
    const merged = mergeSettingsRecordWithLocalStorage(
      {},
      SETTINGS_KEYS,
      (key) => (key === StorageKey.FONT_SIZE ? 'large' : null)
    )
    expect(merged[StorageKey.FONT_SIZE]).toBe('large')
  })

  it('merges auth account secrets from localStorage when IndexedDB lacks them', () => {
    const hex = 'aa'.repeat(32)
    const withSecret = JSON.stringify([{ pubkey: hex, signerType: 'nsec', nsec: 'nsec1stored' }])
    const withoutSecret = JSON.stringify([{ pubkey: hex, signerType: 'nsec' }])
    const merged = mergeSettingsRecordWithLocalStorage(
      { [StorageKey.ACCOUNTS]: withoutSecret },
      SETTINGS_KEYS,
      (key) => (key === StorageKey.ACCOUNTS ? withSecret : null)
    )
    expect(JSON.parse(merged[StorageKey.ACCOUNTS]!)[0].nsec).toBe('nsec1stored')
  })
})
