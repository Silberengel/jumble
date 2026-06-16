/** IndexedDB object store names for {@link ../services/indexed-db.service}. */
export const StoreNames = {
  PROFILE_EVENTS: 'profileEvents',
  RELAY_LIST_EVENTS: 'relayListEvents',
  FOLLOW_LIST_EVENTS: 'followListEvents',
  /** NIP-51 follow sets (kind 30000). Key: pubkey:d */
  FOLLOW_SET_EVENTS: 'followSetEvents',
  MUTE_LIST_EVENTS: 'muteListEvents',
  BOOKMARK_LIST_EVENTS: 'bookmarkListEvents',
  /** Imwald kind 19130: thread roots to mirror in notifications. */
  NOTIFICATION_THREAD_FOLLOW_EVENTS: 'notificationThreadFollowEvents',
  /** Imwald kind 19132: thread roots to hide interaction notifications for. */
  NOTIFICATION_THREAD_MUTE_EVENTS: 'notificationThreadMuteEvents',
  PIN_LIST_EVENTS: 'pinListEvents',
  /** NIP-58 profile badges display list (kind 10008). */
  PROFILE_BADGES_LIST_EVENTS: 'profileBadgesListEvents',
  BLOSSOM_SERVER_LIST_EVENTS: 'blossomServerListEvents',
  INTEREST_LIST_EVENTS: 'interestListEvents',
  MUTE_DECRYPTED_TAGS: 'muteDecryptedTags',
  USER_EMOJI_LIST_EVENTS: 'userEmojiListEvents',
  EMOJI_SET_EVENTS: 'emojiSetEvents',
  FAVORITE_RELAYS: 'favoriteRelays',
  BLOCKED_RELAYS_EVENTS: 'blockedRelaysEvents',
  CACHE_RELAYS_EVENTS: 'cacheRelaysEvents',
  /** Kind 10243 HTTPS index relay list (replaceable by pubkey). */
  HTTP_RELAY_LIST_EVENTS: 'httpRelayListEvents',
  RSS_FEED_LIST_EVENTS: 'rssFeedListEvents',
  RSS_FEED_ITEMS: 'rssFeedItems',
  RELAY_SETS: 'relaySets',
  FOLLOWING_FAVORITE_RELAYS: 'followingFavoriteRelays',
  RELAY_INFOS: 'relayInfos',
  PUBLICATION_EVENTS: 'publicationEvents',
  /** NIP-66: cached list of public lively relay URLs (from 30166 discovery). */
  PUBLIC_LIVELY_RELAYS: 'publicLivelyRelays',
  /** NIP-66: per-relay discovery cache (key = relay URL, value = { discovery, cachedAt }). */
  NIP66_DISCOVERY: 'nip66Discovery',
  /** NIP-A3 payment targets (kind 10133). */
  PAYMENT_INFO_EVENTS: 'paymentInfoEvents',
  /** Cached GIF list (parsed from kind 1063 + 1/1111). Key: 'gifList', value: { gifs, cachedAt }. */
  GIF_CACHE: 'gifCache',
  /** App settings (replaces in-memory/localStorage for persisted settings). Key: setting key, value: string. */
  SETTINGS: 'settings',
  /** NIP-A7 spell events (kind 777). Key: event id. */
  SPELL_EVENTS: 'spellEvents',
  /** Tombstone list for deleted events (kind 5). Key: event id or replaceable coordinate. */
  TOMBSTONE_LIST: 'tombstoneList',
  /** NIP-58 badge definitions (kind 30009). Key: pubkey:d */
  BADGE_DEFINITION_EVENTS: 'badgeDefinitionEvents',
  /** Hot timeline / REQ events (non-replaceable kinds not stored elsewhere). Key: event id hex. */
  EVENT_ARCHIVE: 'eventArchive',
  /** Persisted timeline refs + filter for cold-start hydration. Key: ClientService timeline key hash. */
  TIMELINE_STATE: 'timelineState',
  /** Piper / read-aloud WAV blobs keyed by SHA-256 of endpoint + text + speed. */
  PIPER_TTS_CACHE: 'piperTtsCache',
  /** NIP-52 calendar notes (31922/31923). Key: replaceable dedupe key. Index: `occurrenceStartMs`. */
  CALENDAR_EVENTS: 'calendarEvents',
  /** NIP-52 calendar RSVPs (31925). Key: event id. Index: `parentCoordinate` (`a` tag). */
  CALENDAR_RSVP_EVENTS: 'calendarRsvpEvents',
  /** Kind 9740 payment notifications. Key: event id. Indexes: recipient, referenced event/coordinate. */
  PAYMENT_NOTIFICATION_EVENTS: 'paymentNotificationEvents',
  /** Kind 9741 payment attestations. Key: event id. Indexes: author (attester), target payment id. */
  PAYMENT_ATTESTATION_EVENTS: 'paymentAttestationEvents'
} as const satisfies Record<string, string>
