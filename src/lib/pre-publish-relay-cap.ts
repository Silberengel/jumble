import {
  isSocialKindBlockedKind,
  MAX_PUBLISH_RELAYS,
  READ_ONLY_RELAY_URLS,
  SOCIAL_KIND_BLOCKED_RELAY_URLS
} from '@/constants'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import type { NostrEvent } from 'nostr-tools'

export type TPrePublishRelayCapPreview = {
  outboxSlotsInPublish: number
  selectedContacted: number
  selectedTotal: number
  showCapHint: boolean
  /** True when not every checked relay in the picker can be included in the capped publish list. */
  blocksPublish: boolean
}

/**
 * Pre-publish preview: mirrors merge + cap order in {@link ClientService.publishEvent}: NIP-65 write list first, then
 * relays checked in the post relay picker, capped at {@link MAX_PUBLISH_RELAYS}.
 */
export function computePrePublishRelayCapPreview({
  relayListWrite,
  relayListHttpWrite,
  selectedRelayUrls,
  isPublicMessage,
  parentEvent,
  isDiscussionReply
}: {
  relayListWrite?: string[]
  relayListHttpWrite?: string[]
  selectedRelayUrls: string[]
  isPublicMessage: boolean
  parentEvent?: NostrEvent
  isDiscussionReply: boolean
}): TPrePublishRelayCapPreview {
  const applySocialOutboxFilter =
    !isPublicMessage &&
    (parentEvent == null ||
      isDiscussionReply ||
      (parentEvent != null && isSocialKindBlockedKind(parentEvent.kind)))

  const wsOut = (relayListWrite ?? [])
    .map((u) => normalizeUrl(u) || u)
    .filter((u): u is string => !!u)
  const httpOut = (relayListHttpWrite ?? [])
    .map((u) => normalizeHttpRelayUrl(u) || u)
    .filter((u): u is string => !!u)
  let outbox = dedupeNormalizeRelayUrlsOrdered([...httpOut, ...wsOut])
  const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeAnyRelayUrl(u) || u))
  const socialBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
  outbox = dedupeNormalizeRelayUrlsOrdered(
    outbox.filter((url) => {
      const n = normalizeAnyRelayUrl(url) || url
      if (readOnlySet.has(n)) return false
      if (applySocialOutboxFilter && socialBlockedSet.has(n)) return false
      return true
    })
  )

  const merged = dedupeNormalizeRelayUrlsOrdered([...outbox, ...selectedRelayUrls])
  const capped = merged.slice(0, MAX_PUBLISH_RELAYS)
  const outboxNormSet = new Set(outbox)
  const outboxSlotsInPublish = capped.filter((u) => outboxNormSet.has(u)).length
  const selectedNorm = selectedRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u)
  const selectedContacted = selectedNorm.filter((u) => capped.includes(u)).length

  const showCapHint =
    merged.length > MAX_PUBLISH_RELAYS ||
    selectedRelayUrls.length >= MAX_PUBLISH_RELAYS ||
    selectedContacted < selectedRelayUrls.length

  const blocksPublish = selectedContacted < selectedRelayUrls.length

  return {
    outboxSlotsInPublish,
    selectedContacted,
    selectedTotal: selectedRelayUrls.length,
    showCapHint,
    blocksPublish
  }
}
