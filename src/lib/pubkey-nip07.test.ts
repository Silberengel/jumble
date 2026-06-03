import { describe, expect, it } from 'vitest'
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools'
import { hexPubkeysEqual, pubkeyFromNip07Extension } from './pubkey'

describe('pubkeyFromNip07Extension', () => {
  it('accepts hex pubkey', () => {
    const sk = generateSecretKey()
    const hex = getPublicKey(sk)
    expect(pubkeyFromNip07Extension(hex)).toBe(hex.toLowerCase())
  })

  it('accepts npub', () => {
    const sk = generateSecretKey()
    const hex = getPublicKey(sk)
    const npub = nip19.npubEncode(hex)
    expect(pubkeyFromNip07Extension(npub)).toBe(hex.toLowerCase())
  })

  it('rejects invalid input', () => {
    expect(pubkeyFromNip07Extension('not-a-key')).toBeNull()
    expect(pubkeyFromNip07Extension('')).toBeNull()
  })
})

describe('hexPubkeysEqual', () => {
  it('matches hex and npub for the same key', () => {
    const sk = generateSecretKey()
    const hex = getPublicKey(sk)
    const npub = nip19.npubEncode(hex)
    expect(hexPubkeysEqual(hex, npub)).toBe(true)
    expect(hexPubkeysEqual(npub, hex.toUpperCase())).toBe(true)
  })
})
