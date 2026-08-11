import { argon2id } from '@noble/hashes/argon2'
import { bytesToHex } from '@noble/hashes/utils'
import { describe, expect, it } from 'vitest'
import {
  decodePomegranateGoogleToken,
  massagePomegranateOrigin,
  POMEGRANATE_KIND_CENTRAL_TOKEN,
  pomegranateBunkerUrl,
  pomegranateEmailHashHex
} from './pomegranate'

describe('pomegranate argon2id', () => {
  /**
   * RFC 9106 §5.3 Argon2id test vector. Pins the @noble/hashes parameter semantics
   * (iterations = t, memory in KiB = m, lanes = p, version 0x13) that
   * pomegranateEmailHashHex relies on to match imwald-android's Bouncy Castle
   * implementation (see PomegranateSetupDiscoveryTest) and the Pomegranate admin.
   */
  it('matches the RFC 9106 test vector', () => {
    const out = argon2id(new Uint8Array(32).fill(0x01), new Uint8Array(16).fill(0x02), {
      t: 3,
      m: 32,
      p: 4,
      key: new Uint8Array(8).fill(0x03),
      personalization: new Uint8Array(12).fill(0x04),
      dkLen: 32
    })
    expect(bytesToHex(out)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659')
  })

  it('email hash is deterministic lowercase hex', async () => {
    const first = await pomegranateEmailHashHex('user@example.com')
    const second = await pomegranateEmailHashHex('user@example.com')
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toBe(await pomegranateEmailHashHex('other@example.com'))
  }, 30_000)
})

describe('massagePomegranateOrigin', () => {
  it('normalizes to origin like the admin/Android massageURL', () => {
    expect(massagePomegranateOrigin('https://auth.njump.me/some/path')).toBe(
      'https://auth.njump.me'
    )
    expect(massagePomegranateOrigin('auth.njump.me')).toBe('https://auth.njump.me')
    expect(massagePomegranateOrigin('Http://Auth.Njump.Me/')).toBe('http://auth.njump.me')
    expect(massagePomegranateOrigin('localhost:8080')).toBe('http://localhost:8080')
    expect(massagePomegranateOrigin('https://central.example:8443/x')).toBe(
      'https://central.example:8443'
    )
    expect(massagePomegranateOrigin('')).toBeNull()
    expect(massagePomegranateOrigin(undefined)).toBeNull()
  })
})

describe('pomegranateBunkerUrl', () => {
  it('uses the central as NIP-46 relay without a secret', () => {
    const handler = 'AB'.repeat(32)
    expect(pomegranateBunkerUrl('https://auth.njump.me', handler)).toBe(
      `bunker://${'ab'.repeat(32)}?relay=${encodeURIComponent('wss://auth.njump.me')}`
    )
  })
})

describe('decodePomegranateGoogleToken', () => {
  const tokenFor = (event: object) => btoa(JSON.stringify(event))

  it('accepts a fresh kind-20443 token and extracts the email tag', () => {
    const token = decodePomegranateGoogleToken(
      tokenFor({
        kind: POMEGRANATE_KIND_CENTRAL_TOKEN,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['email', 'user@example.com']]
      })
    )
    expect(token.email).toBe('user@example.com')
  })

  it('rejects wrong kinds, garbage, and expired tokens', () => {
    expect(() => decodePomegranateGoogleToken('not-base64!')).toThrow(
      'Invalid Google sign-in token'
    )
    expect(() =>
      decodePomegranateGoogleToken(
        tokenFor({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [] })
      )
    ).toThrow('Invalid Google sign-in token')
    expect(() =>
      decodePomegranateGoogleToken(
        tokenFor({
          kind: POMEGRANATE_KIND_CENTRAL_TOKEN,
          created_at: Math.floor(Date.now() / 1000) - 25 * 60 * 60,
          tags: []
        })
      )
    ).toThrow('expired')
  })
})
