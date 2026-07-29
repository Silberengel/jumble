import { friendlyBunkerLoginError, isBareNostrSignerWakeUrl, shouldOpenBunkerAuthUrl } from '@/lib/bunker-auth-url'
import { describe, expect, it } from 'vitest'

describe('bunker-auth-url', () => {
  it('ignores bare nostrsigner wake URLs', () => {
    expect(isBareNostrSignerWakeUrl('nostrsigner:')).toBe(true)
    expect(isBareNostrSignerWakeUrl('nostrsigner://')).toBe(true)
    expect(isBareNostrSignerWakeUrl('nostrsigner:wake')).toBe(true)
  })

  it('allows real NIP-55 JSON payloads', () => {
    expect(isBareNostrSignerWakeUrl('nostrsigner:{"type":"sign_event"}')).toBe(false)
    expect(shouldOpenBunkerAuthUrl('nostrsigner:{"type":"sign_event"}')).toBe(true)
  })

  it('allows nostrconnect and allowlisted https hosts', () => {
    expect(shouldOpenBunkerAuthUrl('nostrconnect://abc?relay=wss://relay.nsec.app')).toBe(true)
    expect(shouldOpenBunkerAuthUrl('https://app.nsec.app/login')).toBe(true)
    expect(shouldOpenBunkerAuthUrl('https://evil.example/login')).toBe(false)
  })

  it('maps Amber rejection strings', () => {
    expect(friendlyBunkerLoginError('already connected')).toMatch(/already used/i)
    expect(friendlyBunkerLoginError('invalid secret')).toMatch(/fresh bunker/i)
  })
})
