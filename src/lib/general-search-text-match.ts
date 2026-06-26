import { tryParseCitationEventIdFromQuery } from '@/lib/citation-picker-search'
import { profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import {
  generalSearchHaystack,
  haystackMatchesSearchQuery
} from '@/lib/general-search-scoring'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

// Pure scoring/normalization/highlight primitives live in the worker-safe leaf module and are re-exported
// here so existing import sites (and the IndexedDB token index) keep working unchanged.
export * from '@/lib/general-search-scoring'

/**
 * Client-side “general search”: substring match over readable text fields (not raw id/pubkey/kind).
 * Still resolves npub/nprofile/hex author, note/nevent id, and kind-0 profile queries.
 *
 * Not part of the worker-safe leaf because it imports profile/citation helpers that touch `window`.
 */
export function eventMatchesGeneralSearchQuery(ev: Event, query: string): boolean {
  const raw = query.trim()
  if (!raw) return false

  const decodedAuthor = decodeProfileSearchQueryToPubkeyHex(raw)
  if (decodedAuthor && ev.pubkey.toLowerCase() === decodedAuthor) return true

  const eventId = tryParseCitationEventIdFromQuery(raw)
  if (eventId && ev.id.toLowerCase() === eventId) return true

  if (ev.kind === kinds.Metadata && profileKind0MatchesSearchQuery(ev, raw)) return true

  return haystackMatchesSearchQuery(generalSearchHaystack(ev), raw)
}
