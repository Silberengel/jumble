/**
 * NIP-51 list private items (kind 10000 mute list `content`, etc.).
 * Modern clients encrypt with NIP-44 (self-shared key); legacy uses NIP-04 (`?iv=` suffix).
 * @see https://github.com/nostr-protocol/nips/blob/master/51.md
 */

export type Nip51ListPrivateContentEncryption = 'nip04' | 'nip44'

export type Nip51ListPrivateCrypto = {
  nip04Decrypt: (authorPubkey: string, cipherText: string) => Promise<string>
  nip44Decrypt: (authorPubkey: string, cipherText: string) => Promise<string>
  nip04Encrypt: (authorPubkey: string, plainText: string) => Promise<string>
  nip44Encrypt: (authorPubkey: string, plainText: string) => Promise<string>
}

/** NIP-04 ciphertext includes `?iv=`; NIP-44 is base64 without that suffix. */
export function detectNip51ListPrivateContentEncryption(
  cipherText: string
): Nip51ListPrivateContentEncryption {
  return cipherText.includes('?iv=') ? 'nip04' : 'nip44'
}

async function tryDecrypt(
  version: Nip51ListPrivateContentEncryption,
  authorPubkey: string,
  cipherText: string,
  crypto: Pick<Nip51ListPrivateCrypto, 'nip04Decrypt' | 'nip44Decrypt'>
): Promise<string> {
  if (version === 'nip04') {
    return (await crypto.nip04Decrypt(authorPubkey, cipherText)) ?? ''
  }
  return (await crypto.nip44Decrypt(authorPubkey, cipherText)) ?? ''
}

/** Decrypt kind-10000 (etc.) private tag JSON; auto-detects NIP-44 vs legacy NIP-04. */
export async function decryptNip51ListPrivateContent(
  cipherText: string,
  authorPubkey: string,
  crypto: Pick<Nip51ListPrivateCrypto, 'nip04Decrypt' | 'nip44Decrypt'>
): Promise<{ plainText: string; encryption: Nip51ListPrivateContentEncryption | null }> {
  const trimmed = cipherText.trim()
  if (!trimmed) return { plainText: '', encryption: null }

  const primary = detectNip51ListPrivateContentEncryption(trimmed)
  const fallback: Nip51ListPrivateContentEncryption = primary === 'nip04' ? 'nip44' : 'nip04'

  for (const version of [primary, fallback] as const) {
    try {
      const plainText = await tryDecrypt(version, authorPubkey, trimmed, crypto)
      if (plainText.trim()) {
        return { plainText, encryption: version }
      }
    } catch {
      /* try alternate scheme */
    }
  }

  return { plainText: '', encryption: primary }
}

/** Encrypt private list items; prefers NIP-44 (NIP-51 current), falls back to NIP-04. */
export async function encryptNip51ListPrivateContent(
  plainText: string,
  authorPubkey: string,
  crypto: Nip51ListPrivateCrypto,
  options?: { preferNip44?: boolean }
): Promise<{ cipherText: string; encryption: Nip51ListPrivateContentEncryption }> {
  const preferNip44 = options?.preferNip44 !== false

  if (preferNip44) {
    try {
      const cipherText = (await crypto.nip44Encrypt(authorPubkey, plainText)) ?? ''
      if (cipherText.trim()) {
        return { cipherText, encryption: 'nip44' }
      }
    } catch {
      /* extension may lack nip44 — fall back */
    }
  }

  const cipherText = (await crypto.nip04Encrypt(authorPubkey, plainText)) ?? ''
  return { cipherText, encryption: 'nip04' }
}
