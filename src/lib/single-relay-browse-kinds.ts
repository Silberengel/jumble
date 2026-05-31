import { DOCUMENT_RELAY_URLS, NIP_SEARCH_DOCUMENT_KINDS } from '@/constants'
import { canonicalRelaySessionKey } from '@/lib/url'
import { kinds } from 'nostr-tools'

const documentRelayKeySet = new Set(
  DOCUMENT_RELAY_URLS.map((u) => canonicalRelaySessionKey(u)).filter(Boolean)
)

export function relayUrlIsDocumentRelay(url: string): boolean {
  const key = canonicalRelaySessionKey(url)
  return key.length > 0 && documentRelayKeySet.has(key)
}

/** Kinds for a single-relay browse REQ (picker + document kinds on document relays). */
export function kindsForSingleRelayBrowse(relayUrl: string, showKinds: readonly number[]): number[] {
  const base = showKinds.length > 0 ? [...showKinds] : [kinds.ShortTextNote]
  if (!relayUrlIsDocumentRelay(relayUrl)) return base
  return [...new Set([...base, ...NIP_SEARCH_DOCUMENT_KINDS])]
}
