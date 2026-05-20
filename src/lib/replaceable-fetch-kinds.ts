import { METADATA_CO_FETCH_KINDS } from '@/constants'
import { kinds } from 'nostr-tools'

/** Network `kinds` for a replaceable fetch: kind 0 always includes NIP-A3 payment info (10133). */
export function networkKindsForReplaceableFetch(kind: number): number[] {
  if (kind === kinds.Metadata) return [...METADATA_CO_FETCH_KINDS]
  return [kind]
}
