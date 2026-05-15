import { nip19 } from 'nostr-tools'

const HEX_PUBKEY = /^[0-9a-f]{64}$/i

/**
 * When the search box contains a hex pubkey, `npub`, or `nprofile`, return lowercase hex for
 * profile fetch and IndexedDB kind-0 matching. NIP-50 text search does not match bech32 npubs.
 */
export function decodeProfileSearchQueryToPubkeyHex(raw: string): string | undefined {
  const q = raw.trim().replace(/^nostr:/i, '').trim()
  if (!q) return undefined
  if (HEX_PUBKEY.test(q)) return q.toLowerCase()
  const bech = q
  try {
    const { type, data } = nip19.decode(bech)
    if (type === 'npub' && typeof data === 'string') return data.toLowerCase()
    if (type === 'nprofile' && data && typeof data === 'object' && 'pubkey' in data) {
      const pk = (data as { pubkey: string }).pubkey
      if (typeof pk === 'string' && HEX_PUBKEY.test(pk)) return pk.toLowerCase()
    }
  } catch {
    return undefined
  }
  return undefined
}
