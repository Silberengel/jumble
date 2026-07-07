import { describe, expect, it, vi } from 'vitest'
import {
  decryptNip51ListPrivateContent,
  detectNip51ListPrivateContentEncryption,
  encryptNip51ListPrivateContent
} from './nip51-list-private-content'

describe('nip51-list-private-content', () => {
  it('detects NIP-04 by ?iv= suffix', () => {
    expect(detectNip51ListPrivateContentEncryption('abc?iv=xyz')).toBe('nip04')
    expect(detectNip51ListPrivateContentEncryption('AbcDefGh==')).toBe('nip44')
  })

  it('decrypts NIP-44 ciphertext', async () => {
    const nip44Decrypt = vi.fn().mockResolvedValue('[["p","aa"]]')
    const nip04Decrypt = vi.fn()
    const result = await decryptNip51ListPrivateContent('nip44payload', 'author', {
      nip04Decrypt,
      nip44Decrypt
    })
    expect(result.plainText).toBe('[["p","aa"]]')
    expect(result.encryption).toBe('nip44')
    expect(nip44Decrypt).toHaveBeenCalledWith('author', 'nip44payload')
    expect(nip04Decrypt).not.toHaveBeenCalled()
  })

  it('decrypts NIP-04 ciphertext', async () => {
    const nip44Decrypt = vi.fn()
    const nip04Decrypt = vi.fn().mockResolvedValue('[["p","bb"]]')
    const result = await decryptNip51ListPrivateContent('legacy?iv=iv', 'author', {
      nip04Decrypt,
      nip44Decrypt
    })
    expect(result.plainText).toBe('[["p","bb"]]')
    expect(result.encryption).toBe('nip04')
    expect(nip04Decrypt).toHaveBeenCalledWith('author', 'legacy?iv=iv')
    expect(nip44Decrypt).not.toHaveBeenCalled()
  })

  it('falls back when primary scheme returns empty', async () => {
    const nip44Decrypt = vi.fn().mockResolvedValue('')
    const nip04Decrypt = vi.fn().mockResolvedValue('[["p","fallback"]]')
    const result = await decryptNip51ListPrivateContent('ambiguous', 'author', {
      nip04Decrypt,
      nip44Decrypt
    })
    expect(result.plainText).toBe('[["p","fallback"]]')
    expect(result.encryption).toBe('nip04')
  })

  it('encrypts with NIP-44 when available', async () => {
    const nip44Encrypt = vi.fn().mockResolvedValue('nip44ct')
    const nip04Encrypt = vi.fn()
    const result = await encryptNip51ListPrivateContent('[]', 'author', {
      nip04Decrypt: vi.fn(),
      nip44Decrypt: vi.fn(),
      nip04Encrypt,
      nip44Encrypt
    })
    expect(result).toEqual({ cipherText: 'nip44ct', encryption: 'nip44' })
    expect(nip44Encrypt).toHaveBeenCalledWith('author', '[]')
    expect(nip04Encrypt).not.toHaveBeenCalled()
  })

  it('falls back to NIP-04 when NIP-44 encrypt fails', async () => {
    const nip44Encrypt = vi.fn().mockRejectedValue(new Error('no nip44'))
    const nip04Encrypt = vi.fn().mockResolvedValue('legacy?iv=x')
    const result = await encryptNip51ListPrivateContent('[]', 'author', {
      nip04Decrypt: vi.fn(),
      nip44Decrypt: vi.fn(),
      nip04Encrypt,
      nip44Encrypt
    })
    expect(result).toEqual({ cipherText: 'legacy?iv=x', encryption: 'nip04' })
  })
})
