import type { PublicationEngagementMaps } from '@/lib/library-publication-index'

/** Engagement fetch was removed; library UI uses empty maps until re-enabled. */
export const EMPTY_ENGAGEMENT: PublicationEngagementMaps = {
  labelAddresses: new Set(),
  labelEventIds: new Set(),
  labelValuesByAddress: new Map(),
  labelValuesByEventId: new Map(),
  labelPubkeysByAddress: new Map(),
  labelPubkeysByEventId: new Map(),
  booklistAddresses: new Set(),
  booklistEventIds: new Set(),
  myBooklistAddresses: new Set(),
  myBooklistEventIds: new Set(),
  myCommentAddresses: new Set(),
  myCommentEventIds: new Set(),
  myHighlightAddresses: new Set(),
  myHighlightEventIds: new Set(),
  commentAddresses: new Set(),
  commentEventIds: new Set(),
  highlightAddresses: new Set(),
  highlightEventIds: new Set(),
  bookmarkAddresses: new Set(),
  bookmarkEventIds: new Set(),
  pinAddresses: new Set(),
  pinEventIds: new Set()
}

export const EMPTY_BOOKLIST_TARGETS = { addresses: new Set<string>(), eventIds: new Set<string>() }
