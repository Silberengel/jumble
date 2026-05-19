import { ExtendedKind } from '@/constants'
import { getParentATag, getParentEventHexId, getReplaceableCoordinate, normalizeReplaceableCoordinateString } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'

/** Kind 1111 comment whose immediate parent is the profile kind-0 event (by id or coordinate). */
export function isDirectProfileWallComment(
  event: Event,
  profileEventId: string,
  profilePubkey: string
): boolean {
  if (event.kind !== ExtendedKind.COMMENT) return false
  const profileId = profileEventId.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(profileId)) return false

  const parentHex = getParentEventHexId(event)?.trim().toLowerCase()
  if (parentHex === profileId) return true

  const profileCoord = normalizeReplaceableCoordinateString(
    getReplaceableCoordinate(kinds.Metadata, profilePubkey, '')
  )
  const parentA = getParentATag(event)?.[1]
  if (parentA && normalizeReplaceableCoordinateString(parentA) === profileCoord) return true

  return false
}
