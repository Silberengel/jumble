import {
  MAX_PUBLISH_RELAYS,
  PUBLIC_MESSAGE_RSVP_PUBLISH_AUTHOR_WRITE_CAP,
  PUBLIC_MESSAGE_RSVP_PUBLISH_MAX_RELAYS
} from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { dedupeNormalizeRelayUrlsOrdered, relayUrlsLocalsFirst } from '@/lib/relay-url-priority'
import { collectRemoteReadInboxUrlsFromRelayList } from '@/lib/viewer-read-inboxes'
import { collectWriteOutboxUrlsFromRelayList } from '@/lib/viewer-write-outboxes'
import type { TRelayList } from '@/types'

/** NIP-65 / 10243 outbox URLs for the sender (includes viewer-local outboxes when present on `write`). */
export function collectSenderOutboxUrls(
  relayList: TRelayList | null | undefined,
  extraWriteUrls: readonly string[] = []
): string[] {
  return collectWriteOutboxUrlsFromRelayList(relayList, extraWriteUrls)
}

/** NIP-65 / 10243 inbox URLs for a recipient (drops other people's LAN/loopback). */
export function collectRecipientInboxUrls(relayList: TRelayList | null | undefined): string[] {
  return collectRemoteReadInboxUrlsFromRelayList(relayList)
}

/**
 * Kind 24 / 31925 publish stack: sender outboxes first (capped), then recipient inboxes, then remaining outboxes.
 * No FAST_WRITE, favorites, or read aggregators.
 */
export function buildPublicMessagePublishRelayUrls(
  senderOutbox: readonly string[],
  recipientInbox: readonly string[],
  options?: { blockedRelays?: readonly string[]; maxRelays?: number }
): string[] {
  const authorWriteOrdered = relayUrlsLocalsFirst([...senderOutbox])
  const recipientReadDeduped = dedupeNormalizeRelayUrlsOrdered([...recipientInbox])
  const authorTier1Cap =
    recipientReadDeduped.length > 0
      ? Math.min(PUBLIC_MESSAGE_RSVP_PUBLISH_AUTHOR_WRITE_CAP, authorWriteOrdered.length)
      : authorWriteOrdered.length
  const authorPrimary = authorWriteOrdered.slice(0, authorTier1Cap)
  const authorOverflow = authorWriteOrdered.slice(authorTier1Cap)
  const publishCap =
    recipientReadDeduped.length > 0 ? PUBLIC_MESSAGE_RSVP_PUBLISH_MAX_RELAYS : MAX_PUBLISH_RELAYS

  return feedRelayPolicyUrls(
    [
      { source: 'viewer-write', urls: authorPrimary },
      { source: 'author-read', urls: recipientReadDeduped },
      { source: 'viewer-write', urls: authorOverflow }
    ],
    {
      operation: 'write',
      blockedRelays: options?.blockedRelays,
      maxRelays: options?.maxRelays ?? publishCap,
      nostrLandAggr: 'never',
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
}
