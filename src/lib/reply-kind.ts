import { ExtendedKind, KIND_1111_COMPATIBLE_CLIENT_TAG_SUBSTRINGS } from '@/constants'
import { kinds, type Event } from 'nostr-tools'

/** True when a `client` tag's primary value contains a {@link KIND_1111_COMPATIBLE_CLIENT_TAG_SUBSTRINGS} entry (case-insensitive). */
export function eventHasKind1111CompatibleClientTag(event: Event): boolean {
  const clients = event.tags
    .filter((tag) => tag[0] === 'client' && tag[1])
    .map((tag) => tag[1]!.toLowerCase())
  if (clients.length === 0) return false
  return KIND_1111_COMPATIBLE_CLIENT_TAG_SUBSTRINGS.some((match) => {
    const needle = match.toLowerCase()
    return clients.some((client) => client.includes(needle))
  })
}

/**
 * Draft kind for a thread reply (aitherboard-style):
 * - kind 1 parent → kind 1, unless the parent carries a 1111-compatible `client` tag
 * - everything else → kind 1111
 */
export function resolveReplyDraftKind(parentEvent?: Event, rootEvent?: Event): number {
  if (parentEvent) {
    if (parentEvent.kind === kinds.ShortTextNote) {
      return eventHasKind1111CompatibleClientTag(parentEvent)
        ? ExtendedKind.COMMENT
        : kinds.ShortTextNote
    }
    return ExtendedKind.COMMENT
  }

  if (rootEvent) {
    if (rootEvent.kind === kinds.ShortTextNote) {
      return eventHasKind1111CompatibleClientTag(rootEvent)
        ? ExtendedKind.COMMENT
        : kinds.ShortTextNote
    }
    return ExtendedKind.COMMENT
  }

  return ExtendedKind.COMMENT
}
