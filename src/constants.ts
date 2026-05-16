import { kinds, type Filter } from 'nostr-tools'

/** Git Republic web UI for repository links; override with VITE_GITREPUBLIC_WEB_BASE_URL for self-hosted. */
export const GITREPUBLIC_WEB_BASE_URL = (
  (import.meta.env.VITE_GITREPUBLIC_WEB_BASE_URL as string | undefined) ?? 'https://gitrepublic.imwald.eu'
)
  .trim()
  .replace(/\/$/, '')

/**
 * Piper TTS (same contract as `POST /api/piper-tts`: JSON `{ text, voice?, speed? }`, body `audio/wav`).
 * Default production: `/api/piper-tts` (same origin; reverse-proxy to Wyoming — e.g. `services/piper-tts-proxy` or any host implementing that path — see PROXY_SETUP.md).
 * For cross-origin aitherboard instead, set full URL and configure CORS on that host.
 * If empty, read-aloud uses the Web Speech API only.
 */
export const READ_ALOUD_TTS_URL =
  (import.meta.env.VITE_READ_ALOUD_TTS_URL as string | undefined)?.trim() || ''

/**
 * Self-hosted LanguageTool HTTP API (same-origin proxy recommended; path is base URL without `/v2/check`).
 * Example: `/api/languagetool` proxied to `http://127.0.0.1:8010`. Empty disables grammar hints in the advanced lab.
 */
export const LANGUAGE_TOOL_URL =
  (import.meta.env.VITE_LANGUAGE_TOOL_URL as string | undefined)?.trim() || ''

/**
 * LibreTranslate-compatible `POST /translate` base (no trailing slash). Empty disables translate actions in the lab.
 */
export const TRANSLATE_URL =
  (import.meta.env.VITE_TRANSLATE_URL as string | undefined)?.trim() || ''

/** HiveTalk (WebRTC video call) base URL; override with VITE_HIVETALK_BASE_URL for self-hosted instances. */
export const HIVETALK_BASE_URL =
  (import.meta.env.VITE_HIVETALK_BASE_URL as string | undefined) ?? 'https://honey.hivetalk.org'

/**
 * Stable reference to this module's URL at load time.
 * `import.meta.url` alone is left untouched by Vite (only `new URL(path, import.meta.url)`
 * with a literal/template path gets transformed into a static asset map).
 * In the Electron build (dist/assets/*.js) this is something like:
 *   file:///path/to/dist/assets/index-abc.js
 */
const _moduleHref: string = import.meta.url

/**
 * URL for a file from `public/` (banner, favicon, payto logos, etc.).
 * Uses Vite `base`: `/` for web and packaged Electron (renderer is served from `http://127.0.0.1:*`; see
 * `electron/main.cjs`). The `file:` branch remains for opening `dist/index.html` directly from disk.
 *
 * For `file:` we derive the `dist/` root from the chunk's own URL. The chunk lives at
 * `dist/assets/*.js`, so `/assets/` marks the boundary: everything before it is the dist root.
 * Vite would transform `new URL(\`../${dynamic}\`, import.meta.url)` into a static glob map that
 * does NOT include `public/` copies, so we must NOT use that pattern here.
 */
export function publicAssetUrl(assetPath: string): string {
  const trimmed = assetPath.replace(/^\//, '')
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    const assetsIdx = _moduleHref.lastIndexOf('/assets/')
    if (assetsIdx !== -1) {
      // e.g. "file:///path/to/dist/" + "banner.png"
      return _moduleHref.slice(0, assetsIdx + 1) + trimmed
    }
  }
  return `${import.meta.env.BASE_URL}${trimmed}`
}

/**
 * Default URL for the sidebar “Download desktop app” entry (e.g. GitHub Releases with AppImage/deb).
 * Override per deploy with `DESKTOP_DOWNLOAD_URL` in `/config.json` (empty string hides the entry).
 */
export const DESKTOP_APP_DOWNLOAD_URL_DEFAULT =
  'https://github.com/Silberengel/jumble/releases'

export const DEFAULT_FAVORITE_RELAYS = [
  'wss://theforest.nostr1.com',
  'wss://nostr.land'
]

/**
 * Max concurrent relay connection + REQ setups (ensureRelay + subscribe) app-wide.
 * Limits parallel WebSocket handshakes when many relays or timeline shards open at once.
 */
export const MAX_CONCURRENT_RELAY_CONNECTIONS = 10

/**
 * Max concurrent live REQ subscriptions on a single relay. Some relays enforce ≤10 SUBs; stay under
 * the advertised cap to avoid "too many subscriptions" NOTICEs when other clients or shards overlap.
 * Use 7 so overlapping timeline waves / auth resubscribe still stay below 10.
 */
export const MAX_CONCURRENT_SUBS_PER_RELAY = 7

/**
 * How many timeline shards may open relay subscriptions at once. Each shard sends one REQ per relay
 * in its list; with 6 shards in parallel a popular relay can see 6+ SUBs from this app alone, and a
 * second feed wave (remount / strict mode) pushes past strict relay caps (e.g. nostr.sovbit.host ≤10).
 * 5 balances faster multi-shard home loads against per-relay SUB caps (see {@link MAX_CONCURRENT_SUBS_PER_RELAY}).
 */
export const TIMELINE_SHARD_SUBSCRIBE_CONCURRENCY = 5

/** Max relays to publish each event to (outboxes first, then targets' inboxes, then extras). */
export const MAX_PUBLISH_RELAYS = 20

/**
 * Kind 24 / 31925: reserve space for organizer/recipient inboxes instead of letting the author's outboxes consume
 * the entire {@link MAX_PUBLISH_RELAYS} budget first.
 */
export const PUBLIC_MESSAGE_RSVP_PUBLISH_MAX_RELAYS = 28

/** When publishing kind 24 / 31925 to recipients, only the first N author outbox URLs fill tier‑1 before inboxes. */
export const PUBLIC_MESSAGE_RSVP_PUBLISH_AUTHOR_WRITE_CAP = 10

/** After a publish wave, failed NIP-65 write (outbox) relays are retried once after this delay. */
export const OUTBOX_PUBLISH_RETRY_DELAY_MS = 5000

/**
 * After the first relay accepts a publish, resolve {@link ClientService.publishEvent} after this many ms
 * so the UI does not wait for every slow or dead relay (callers typically only need ≥1 success).
 */
export const EARLY_PUBLISH_SUCCESS_GRACE_MS = 900

/**
 * Budget for `fetchRelayLists` / NIP-65 resolution on the publish path. Longer waits block the reply button
 * while relays stall; shorter values fall back to IndexedDB + deduped picker order sooner (still correct).
 */
export const PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS = 20_000

/**
 * How long {@link ClientService.fetchRelayLists} waits on the network before returning an IndexedDB + default
 * merge. Must allow {@link ReplaceableEventService.fetchReplaceableEventsFromProfileFetchRelays} (10002 + 10243)
 * plus kind-10432 discovery to finish on slow relays; otherwise we never persist others’ NIP-65 and the cache
 * stays empty except for the account’s own hydration path.
 */
export const FETCH_RELAY_LIST_UI_TIMEOUT_MS = 10_000

/**
 * Hard cap for {@link useFetchRelayList}: if {@link ClientService.fetchRelayList} never settles (deduped hang,
 * IDB edge case), clear the in-flight dedupe entry and fall back to {@link ClientService.peekRelayListFromStorage}
 * so the UI cannot stay on “loading…” forever.
 */
export const FETCH_RELAY_LIST_HOOK_MAX_MS = FETCH_RELAY_LIST_UI_TIMEOUT_MS + 12_000

/**
 * {@link ClientService.prioritizePublishUrlListWithTimeout}: must exceed {@link PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS}
 * so one full `fetchRelayLists` budget can elapse before we fall back to “deduped order without inbox fetch”.
 */
export const PUBLISH_PRIORITIZE_RELAY_ORDER_TIMEOUT_MS = PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS + 14_000

/**
 * When {@link ClientService.publishEvent} targets more than one relay, cap per-relay publish ACK wait so one
 * hung relay (e.g. 90s timeout) does not delay returning until every parallel publish settles. Single-relay
 * publishes keep {@link RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS} for extension signers on slow paths.
 */
export const MULTI_RELAY_PUBLISH_ACK_CAP_MS = 16_000

/**
 * When many relays are targeted, cap the `ensureRelay` handshake race so the reply/post dialog does not sit
 * on “Publishing…” while several slow TLS peers each burn the full pool timeout in parallel.
 */
export const PUBLISH_MULTI_RELAY_CONNECTION_CAP_MS = 12_000

/** Max merged URLs per REQ / timeline relay list (see `relay-url-priority`). */
export const MAX_REQ_RELAY_URLS = MAX_CONCURRENT_RELAY_CONNECTIONS

/**
 * Maximum `kinds` length in a single NIP-01 filter. Some relays NOTICE "too many kinds" and reject the
 * entire REQ (e.g. strfry derivatives, relay.vukihreedia.xyz). QueryService splits larger arrays into
 * multiple filters with the same tag scope.
 */
export const RELAY_FILTER_MAX_KINDS_PER_OBJECT = 10

/**
 * Maximum NIP-01 filters per REQ (`["REQ", subId, …filters]`). Primal, damus.io, and others return
 * NOTICE `bad req: arr too big` when the filter list is long (e.g. replaceable threads with #a + #e
 * snapshot + many kind-chunked op-reference filters).
 */
export const RELAY_REQ_MAX_FILTERS_PER_MESSAGE = 10

/** `SimplePool.ensureRelay` WebSocket handshake timeout (parallel multi-relay + slow TLS). */
export const RELAY_POOL_CONNECTION_TIMEOUT_MS = 20_000

/**
 * Minimum `ensureRelay` connect timeout for `READ_ONLY_RELAY_URLS` (NIP-42 aggregators): must outlast queued
 * extension `signEvent` when many relays send `AUTH` at once.
 */
export const RELAY_READ_ONLY_POOL_CONNECT_TIMEOUT_MS = 45_000

/**
 * nostr-tools `AbstractRelay.publishTimeout`: EVENT publish ACK and NIP-42 AUTH OK wait.
 * Default 4400ms is too tight when a browser extension queues many `signEvent` calls.
 */
export const RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS = 90_000

/** Multi-relay queries and timeline initial REQ: after the first event, wait this long then close (query) or finalize EOSE (live feed) while keeping the subscription open for new events. */
export const FIRST_RELAY_RESULT_GRACE_MS = 2000

/**
 * Timelines that include HTTP index relays: interval between periodic `query()` polls while the WebSocket
 * subscription stays open (HTTP relays do not receive live `EVENT` over REQ).
 */
export const HTTP_TIMELINE_POLL_INTERVAL_MS = 45_000

/** Subtracted from the polling `since` cursor so borderline events are not missed between polls. */
export const HTTP_TIMELINE_POLL_SINCE_OVERLAP_SEC = 120

/**
 * Implicit query feed grace ({@link FIRST_RELAY_RESULT_GRACE_MS}) applies only when the largest `limit` among
 * filters is at least this value. Omitting `limit` counts as 0 (no implicit grace).
 */
export const FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT = 200

/**
 * Kindless single-relay page REQ: explicit `limit`, no `kinds` (see NoteList `allowKindlessRelayExplore`).
 */
export const SINGLE_RELAY_KINDLESS_REQ_LIMIT = 500

/**
 * If a kindless single-relay REQ hasn't EOSEd within this many milliseconds, fall back to an
 * explicit-kinds filter (same path as when the kindless query returns no events). Prevents
 * relays that are very slow on open-ended filters from stalling the home feed indefinitely.
 */
export const SINGLE_RELAY_KINDLESS_EOSE_TIMEOUT_MS = 6000

/**
 * Minimum time between full account network hydrates (NostrProvider: relay + replaceable fetch from relays).
 * IndexedDB cache still applies on every load; this only skips redundant network merges after a recent run.
 */
export const ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Failsafe: clear {@link NostrProvider} `isAccountSessionHydrating` if the hydrate promise never settles (hung relays, etc.). */
export const ACCOUNT_SESSION_HYDRATE_WALL_MS = 60_000

/**
 * Batched kind-0 queries (ReplaceableEventService) over many relays (inbox, favorites, cache, defaults).
 * Too low causes empty profiles and NIP-05 gaps when relays are slow or many URLs are queried.
 */
export const METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS = 18000
/** After all relays EOSE, wait this long before closing so slow EVENTs still land (slot queue + TLS). */
export const METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS = 4000
/**
 * Max `authors` per REQ for batched kind-0; large arrays are split so relays return more complete rows.
 */
export const METADATA_BATCH_AUTHORS_CHUNK = 22

/**
 * Hard wall on {@link ReplaceableEventService.fetchProfilesForPubkeys} (feed / thread batch avatars).
 * On timeout, callers get session/IndexedDB rows plus {@link TProfile.batchPlaceholder} for gaps.
 */
export const FEED_PROFILE_BATCH_FETCH_TIMEOUT_MS = 14_000

/**
 * After this delay while a pubkey stays in the feed’s `pendingPubkeys` set, {@link useFetchProfile}
 * may run a per-pubkey fetch. Must exceed {@link FEED_PROFILE_BATCH_FETCH_TIMEOUT_MS} so we do not
 * stack batch + N individual profile REQs on the same refresh.
 */
export const FEED_PROFILE_PENDING_BATCH_ESCAPE_MS = FEED_PROFILE_BATCH_FETCH_TIMEOUT_MS + 4_000

/** Network-only cap on {@link ReplaceableEventService.fetchReplaceableEventsFromProfileFetchRelays} `loadMany`. */
export const PROFILE_BATCH_NETWORK_LOAD_TIMEOUT_MS = 12_000

/**
 * Hex-id / replaceable-coordinate note lookup ({@link EventService.tryHarderToFetchEvent}, big-relays dataloader).
 */
export const SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS = 5_000
export const SINGLE_EVENT_BY_ID_QUERY_GLOBAL_TIMEOUT_MS = 28_000

/** Parent-tag / seen-on relay hints only — before big-relay fan-out ({@link EventService._fetchEvent}). */
export const HINTED_EVENT_FETCH_EOSE_TIMEOUT_MS = 2_000
export const HINTED_EVENT_FETCH_GLOBAL_TIMEOUT_MS = 5_000

/** Wide REQ for embeds / explicit external lists ({@link EventService.fetchEventWithExternalRelays}). */
export const EXTERNAL_RELAY_EVENT_FETCH_EOSE_TIMEOUT_MS = 14_000
export const EXTERNAL_RELAY_EVENT_FETCH_GLOBAL_TIMEOUT_MS = 40_000

/**
 * useFetchProfile: outer Promise.race on fetchProfileEvent and wait-for-shared-promise timeouts.
 * Must be greater than {@link METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS} so the batch can finish first.
 */
export const PROFILE_FETCH_PROMISE_TIMEOUT_MS = 22_000

/**
 * Public Blossom (BUD) upload bases: presets in post settings and merged after the user’s
 * kind-10063 URLs when resolving the default Blossom server list.
 * @see https://blossom.happytavern.co/ — Lotus-style ephemeral Blossom (0x0 backend).
 */
export const STANDARD_BLOSSOM_UPLOAD_HOSTS = [
  { url: 'https://0x0.happytavern.co', labelKey: 'BlossomUploadOptionHappyTavern' },
  { url: 'https://blossom.band', labelKey: 'BlossomUploadOptionBand' },
  { url: 'https://blossom.primal.net', labelKey: 'BlossomUploadOptionPrimal' },
  { url: 'https://nostr.media', labelKey: 'BlossomUploadOptionNostrMedia' },
  { url: 'https://blossom.nostr.build', labelKey: 'BlossomUploadOptionNostrBuild' }
] as const

export const RECOMMENDED_BLOSSOM_SERVERS = STANDARD_BLOSSOM_UPLOAD_HOSTS.map((h) => h.url)

/** Prefix for media-upload Select values that pin a Blossom host (`URL` is URI-encoded after this). */
export const BLOSSOM_PRESET_SELECT_PREFIX = 'blossom-preset:'
/** [Lotus](https://github.com/0ceanSlim/lotus) — self-hosted Blossom (BUD) server (see GitHub for cdn_url / api_addr). */
export const LOTUS_BLOSSOM_REPO_URL = 'https://github.com/0ceanSlim/lotus'

export const StorageKey = {
  VERSION: 'version',
  THEME_SETTING: 'themeSetting',
  /** Resolved theme (light/dark) written by ThemeProvider; stored in IndexedDB. */
  THEME: 'theme',
  FONT_SIZE: 'fontSize',
  RELAY_SETS: 'relaySets',
  ACCOUNTS: 'accounts',
  CURRENT_ACCOUNT: 'currentAccount',
  ADD_CLIENT_TAG: 'addClientTag',
  NOTE_LIST_MODE: 'noteListMode',
  NOTIFICATION_TYPE: 'notificationType',
  DEFAULT_ZAP_SATS: 'defaultZapSats',
  DEFAULT_ZAP_COMMENT: 'defaultZapComment',
  QUICK_ZAP: 'quickZap',
  ZAP_REPLY_THRESHOLD: 'zapReplyThreshold',
  /** Per-pubkey ms timestamps: last full network hydrate (see ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS). */
  ACCOUNT_NETWORK_HYDRATE_AT_MAP: 'accountNetworkHydrateAtMap',
  AUTOPLAY: 'autoplay',
  HIDE_UNTRUSTED_INTERACTIONS: 'hideUntrustedInteractions',
  HIDE_UNTRUSTED_NOTIFICATIONS: 'hideUntrustedNotifications',
  MEDIA_UPLOAD_SERVICE_CONFIG_MAP: 'mediaUploadServiceConfigMap',
  HIDE_UNTRUSTED_NOTES: 'hideUntrustedNotes',
  DEFAULT_SHOW_NSFW: 'defaultShowNsfw',
  DISMISSED_TOO_MANY_RELAYS_ALERT: 'dismissedTooManyRelaysAlert',
  SHOW_KINDS: 'showKinds',
  SHOW_KINDS_VERSION: 'showKindsVersion',
  SHOW_KIND_1_OPs: 'showKind1OPs',
  SHOW_KIND_1_REPLIES: 'showKind1Replies',
  SHOW_KIND_1111: 'showKind1111',
  /** When true, main feed REQs omit `kinds` and the client does not filter by kind (testing). */
  FEED_KIND_FILTER_BYPASS: 'feedKindFilterBypass',
  /** @deprecated use SHOW_KIND_1_REPLIES + SHOW_KIND_1111 */
  SHOW_REPLIES_AND_COMMENTS: 'showRepliesAndComments',
  HIDE_CONTENT_MENTIONING_MUTED_USERS: 'hideContentMentioningMutedUsers',
  NOTIFICATION_LIST_STYLE: 'notificationListStyle',
  MEDIA_AUTO_LOAD_POLICY: 'mediaAutoLoadPolicy',
  SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS: 'shownCreateWalletGuideToastPubkeys',
  SHOW_RECOMMENDED_RELAYS_PANEL: 'showRecommendedRelaysPanel',
  DEFAULT_EXPIRATION_ENABLED: 'defaultExpirationEnabled',
  DEFAULT_EXPIRATION_MONTHS: 'defaultExpirationMonths',
  DEFAULT_QUIET_ENABLED: 'defaultQuietEnabled',
  DEFAULT_QUIET_DAYS: 'defaultQuietDays',
  RESPECT_QUIET_TAGS: 'respectQuietTags',
  GLOBAL_QUIET_MODE: 'globalQuietMode',
  SHOW_RSS_FEED: 'showRssFeed',
  PANE_MODE: 'paneMode',
  ADD_RANDOM_RELAYS_TO_PUBLISH: 'addRandomRelaysToPublish',
  /** When not `'false'`, show green Sonner toasts after successful publishes (default on). */
  SHOW_PUBLISH_SUCCESS_TOASTS: 'showPublishSuccessToasts',
  /** When not `'false'`, show NIP-53 live activity banner (default on). */
  SHOW_LIVE_ACTIVITIES_BANNER: 'showLiveActivitiesBanner',
  /** Max approximate archive size (MB). `0` in UI means “use platform default”. */
  EVENT_ARCHIVE_MAX_MB: 'eventArchiveMaxMb',
  /** Max rows in event archive. `0` means use platform default. */
  EVENT_ARCHIVE_MAX_EVENTS: 'eventArchiveMaxEvents',
  /** In-memory session LRU max (events). Platform default if unset. */
  SESSION_EVENT_LRU_MAX: 'sessionEventLruMax',
  /** Temporary draft cache: new notes and replies. Persisted after 30s idle; restored on refresh; cleared on logout/switch. */
  POST_EDITOR_DRAFT: 'postEditorDraft',
  MEDIA_UPLOAD_SERVICE: 'mediaUploadService', // deprecated
  HIDE_UNTRUSTED_EVENTS: 'hideUntrustedEvents', // deprecated
  ACCOUNT_RELAY_LIST_EVENT_MAP: 'accountRelayListEventMap', // deprecated
  ACCOUNT_FOLLOW_LIST_EVENT_MAP: 'accountFollowListEventMap', // deprecated
  ACCOUNT_MUTE_LIST_EVENT_MAP: 'accountMuteListEventMap', // deprecated
  ACCOUNT_MUTE_DECRYPTED_TAGS_MAP: 'accountMuteDecryptedTagsMap', // deprecated
  ACCOUNT_PROFILE_EVENT_MAP: 'accountProfileEventMap', // deprecated
  ACTIVE_RELAY_SET_ID: 'activeRelaySetId', // deprecated
  FEED_TYPE: 'feedType' // deprecated
}

export const FONT_SIZE = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large'
} as const

/**
 * Random public relays (from NIP-66 lively list; write-tested monitors preferred) merged into the
 * publish relay picker. More candidates improve odds some accept open writes.
 */
export const RANDOM_PUBLISH_RELAY_COUNT = 5

/** Relays to query for NIP-66 relay monitoring events (30166), in addition to FAST_READ_RELAY_URLS. */
export const NIP66_DISCOVERY_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.nostr.watch',
  'wss://relaypag.es'
]

// Relay with bookstr composite index support
export const BOOKSTR_RELAY_URLS = [
  'wss://orly-relay.imwald.eu'
]

/**
 * Primary document relay for long-form/wiki/publication kinds:
 * 30023, 30818, 30817, 30041, 30040.
 */
export const DOCUMENT_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.wikifreedia.xyz'
] as const

/**
 * Relays that must never receive publishes: search engines, index mirrors, and similar endpoints that only ingest
 * or aggregate for read. Use only to strip URLs from publish / write / publish-picker paths — do not prepend this
 * list to generic read REQ stacks. Distinct from {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} (kind-coverage limits).
 */
export const READ_ONLY_RELAY_URLS = [
  'wss://aggr.nostr.land',
  'wss://relay.nostr.watch',
  'wss://relaypag.es',
  'wss://relay.noswhere.com',
  'wss://search.nos.today',
  'wss://trending.nostr.wine',
  'wss://relay.nip46.com',
  'wss://filter.nostr.wine',
  'wss://primus.nostr1.com'
]

/**
 * Relays that need NIP-42 signed before the first REQ returns useful data. Same pool treatment as
 * {@link READ_ONLY_RELAY_URLS} (longer connect timeout + proactive `automaticallyAuth`), but **not**
 * necessarily read-only for publish — keep those relays out of {@link READ_ONLY_RELAY_URLS}.
 */
export const NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS = ['wss://nostr.wine'] as const

/**
 * Relays that reject or poorly serve “social” kinds (short notes, discussions, URL comments).
 * Strip these from REQ/publish relay stacks when the filter or event uses {@link SOCIAL_KIND_BLOCKED_KINDS},
 * or when a filter omits `kinds` (broad timeline).
 */
export const SOCIAL_KIND_BLOCKED_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://profiles.nostr1.com',
  'wss://purplepag.es',
  'wss://relay.nsec.app',
  'wss://bucket.coracle.social',
  'wss://spatia-arcana.com',
  'wss://relay.wikifreedia.xyz',
  'wss://relay.gifbuddy.lol',
  'wss://hist.nostr.land',
]

// Optimized relay list for read operations (includes aggregator)
export const FAST_READ_RELAY_URLS = [
  'wss://theforest.nostr1.com',
  'wss://nostr.land',
  'wss://nostr.wine',
  'wss://orly-relay.imwald.eu',
  'wss://nostr21.com'
]

// Optimized relay list for write operations (no aggregator since it's read-only)
export const FAST_WRITE_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com',
  'wss://nos.lol'
]

/** Relays used for NIP-94 file metadata (kind 1063) / GIF discovery and publish.
 *  Publish to all of these so GIFs are discoverable across clients; some may be temporarily down. */
export const GIF_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com',
  'wss://nos.lol',
  'wss://nostr.mom'
]

export const SEARCHABLE_RELAY_URLS = [
  'wss://search.nos.today',
  'wss://nostr.wine',
  'wss://orly-relay.imwald.eu',
  'wss://relay.noswhere.com',
  'wss://nostr-pub.wellorder.net'
]

export const PROFILE_RELAY_URLS = [
  'wss://profiles.nostr1.com',
  'wss://purplepag.es',
  'wss://profiles.nostrver.se/',
  'wss://indexer.coracle.social/'
]

export const FOLLOWS_HISTORY_RELAY_URLS = [
  'wss://hist.nostr.land'
]

export const ExtendedKind = {
  PICTURE: 20,
  VIDEO: 21,
  SHORT_VIDEO: 22,
  /** NIP-71: addressable normal video (same rendering as {@link ExtendedKind.VIDEO}). */
  VIDEO_ADDRESSABLE: 34235,
  POLL: 1068,
  /** NIP-B9 zap poll (paid votes via zaps). */
  ZAP_POLL: 6969,
  POLL_RESPONSE: 1018,
  COMMENT: 1111,
  VOICE: 1222,
  VOICE_COMMENT: 1244,
  PUBLIC_MESSAGE: 24,
  DISCUSSION: 11,
  FAVORITE_RELAYS: 10012,
  BLOCKED_RELAYS: 10006,
  BLOSSOM_SERVER_LIST: 10063,
  CACHE_RELAYS: 10432,
  /** HTTPS index-relay list (same `r` tag semantics as kind 10002; URLs are http/https). */
  HTTP_RELAY_LIST: 10243,
  RELAY_REVIEW: 31987,
  GROUP_METADATA: 39000,
  /** NIP-51 follow sets (addressable); `p` tags name pubkeys in the set */
  FOLLOW_SET: 30000,
  ZAP_REQUEST: 9734,
  ZAP_RECEIPT: 9735,
  PUBLICATION: 30040,
  WIKI_ARTICLE: 30818,
  WIKI_ARTICLE_MARKDOWN: 30817,
  PUBLICATION_CONTENT: 30041,
  CITATION_INTERNAL: 30,
  CITATION_EXTERNAL: 31,
  CITATION_HARDCOPY: 32,
  CITATION_PROMPT: 33,
  RSS_FEED_LIST: 10895,
  /** Client-only synthetic "parent" for RSS article threads; never published to relays */
  RSS_THREAD_ROOT: 99999,
  /**
   * NIP-18: generic repost (kind 16) for any event **except** kind 1 — zaps (9735), reactions, comments, etc.
   * Kind **6** (`kinds.Repost` from nostr-tools) is only for reposting kind 1. See `createRepostDraftEvent`.
   */
  GENERIC_REPOST: 16,
  /** NIP-25: reaction to external content (NIP-73 `k` + `i`), e.g. http(s) URLs */
  EXTERNAL_REACTION: 17,
  // NIP-89 Application Handlers
  APPLICATION_HANDLER_RECOMMENDATION: 31989,
  APPLICATION_HANDLER_INFO: 31990,
  PAYMENT_INFO: 10133,
  FOLLOW_PACK: 39089,
  /** NIP-56: reporting / flagging (tagged `p` for reported pubkey, optional `e` for reported note) */
  REPORT: 1984,
  /** NIP-94 File Metadata (e.g. GIFs) */
  FILE_METADATA: 1063,
  /** NIP-66 Relay discovery (relay characteristics from NIP-11 or probing) */
  RELAY_DISCOVERY: 30166,
  /** NIP-66 Relay monitor announcement (intent to publish 30166 at a frequency) */
  RELAY_MONITOR_ANNOUNCEMENT: 10166,
  /** NIP-52 Date-based calendar event (all-day / multi-day) */
  CALENDAR_EVENT_DATE: 31922,
  /** NIP-52 Time-based calendar event */
  CALENDAR_EVENT_TIME: 31923,
  /** NIP-52 Calendar event RSVP */
  CALENDAR_EVENT_RSVP: 31925,
  /** NIP-A7 Spells: portable relay query filters (kind 777) */
  SPELL: 777,
  /** NIP-58 Badges: profile badges list (addressable, d=profile_badges) */
  PROFILE_BADGES: 30008,
  /** NIP-58 Badges: badge definition (addressable) */
  BADGE_DEFINITION: 30009,
  /** Web page bookmark (URL in i/I or r tags); used in RSS+Web relay discovery */
  WEB_BOOKMARK: 39701,
  /** NIP-34 / Git Republic: repository announcement (addressable) */
  GIT_REPO_ANNOUNCEMENT: 30617,
  /** NIP-34 / Git Republic: issue */
  GIT_ISSUE: 1621,
  /** Git Republic: release (linked to repo via `a` tag) */
  GIT_RELEASE: 1642,
  /**
   * Imwald: replaceable list (`e` / `a` refs) of thread roots whose replies should appear in your
   * notifications as if you authored the root.
   */
  EVENTS_I_FOLLOW_NOTIFICATIONS_LIST: 19130,
  /**
   * Imwald: replaceable list (`e` / `a` refs) of thread roots whose replies you do not want in
   * notifications (e.g. noisy or hostile threads).
   */
  EVENTS_I_MUTED_NOTIFICATIONS_LIST: 19132
}

/**
 * Relay-local experiment: event `id` is the standard Nostr hash, but `sig` is empty.
 * Not verifiable on the public relay network; relays that accept writes should require NIP-42 AUTH first.
 */
export const UNSIGNED_EXPERIMENTAL_KIND_MIN = 69999
export const UNSIGNED_EXPERIMENTAL_KIND_MAX = 130000

export function isUnsignedExperimentalKind(kind: number): boolean {
  return kind >= UNSIGNED_EXPERIMENTAL_KIND_MIN && kind <= UNSIGNED_EXPERIMENTAL_KIND_MAX
}

/** NIP-71 regular + addressable video kinds (21, 22, 34235). Kind 34236 is not supported. */
export const NIP71_VIDEO_KINDS: readonly number[] = [
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VIDEO_ADDRESSABLE
]

const NIP71_VIDEO_KIND_SET = new Set<number>(NIP71_VIDEO_KINDS)

/** True for NIP-71 normal/short video events (regular or addressable). */
export function isNip71StyleVideoKind(kind: number): boolean {
  return NIP71_VIDEO_KIND_SET.has(kind)
}

/**
 * When these kinds are ingested via {@link EventService.addEventToCache}, the client prefetches the event
 * author's kind 3 + 10002 (contacts + NIP-65) so profile / relay UIs and publish routing stay warm.
 * Omits reactions/zaps where `pubkey` is not the primary profile identity for the row.
 *
 * Empty by default: each hit used to schedule batched relay + IndexedDB work (see
 * {@link ClientService.prefetchAuthorCoreReplaceables}) and could overwhelm the browser on busy feeds.
 * Author lists still load from profile views, publish flow, and session prewarm.
 */
export const AUTHOR_CORE_PREFETCH_ON_INGEST_KINDS: ReadonlySet<number> = new Set<number>()

/** Short-form portrait-style bucket (kind 22 only; addressable 34236 is not supported). */
export function isNip71ShortVideoKind(kind: number): boolean {
  return kind === ExtendedKind.SHORT_VIDEO
}

/** Max kind for signed “custom event” notes in the generic composer (below the unsigned experimental range). */
export const MAX_SIGNED_CUSTOM_EVENT_KIND = 40000

/**
 * Kinds subscribed on `#e` / `#a` for the OP in {@link useQuoteEvents} (thread “backlinks” shard),
 * alongside kind-1 `#q` quotes. Covers highlights, long-form, NIP-32 labels, NIP-56 reports,
 * NIP-51 lists (bookmarks, pins, generic/bookmark/curation sets), and NIP-58 badge awards.
 */
export const THREAD_BACKLINK_STREAM_KINDS: readonly number[] = [
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.PUBLICATION_CONTENT,
  kinds.Label,
  kinds.Report,
  kinds.BookmarkList,
  kinds.Pinlist,
  kinds.Genericlists,
  kinds.Bookmarksets,
  kinds.Curationsets,
  kinds.BadgeAward
]

/**
 * Kinds that reference an OP via `#e` / `#E` / `#a` / `#A` / `#q` in note-stats and thread REQ filters.
 * Extends {@link THREAD_BACKLINK_STREAM_KINDS} with publication headers (30040) that may tag notes without using 30041.
 * REQ tag keys: `e`, `E`, `a`, `A`, `q` only (no `#Q`).
 */
export const NOTE_STATS_OP_REFERENCE_KINDS: readonly number[] = Array.from(
  new Set<number>([...THREAD_BACKLINK_STREAM_KINDS, ExtendedKind.PUBLICATION])
).sort((a, b) => a - b)

/** {@link NOTE_STATS_OP_REFERENCE_KINDS} without kind 9802 — pair with a small highlights-only filter on relays that cap `kinds`. */
export const NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT: readonly number[] =
  NOTE_STATS_OP_REFERENCE_KINDS.filter((k) => k !== kinds.Highlights)

/**
 * When a filter touches these kinds (or omits `kinds`), omit {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} from the relay
 * stack — those relays do not carry this note/comment surface (kinds **1** / **1111** / **11** per relay policy).
 * @see {@link relayFilterIncludesSocialKindBlockedKind}
 */
const SOCIAL_KIND_BLOCKED_KINDS: readonly number[] = [
  kinds.ShortTextNote,
  ExtendedKind.DISCUSSION,
  ExtendedKind.COMMENT
]

const SOCIAL_KIND_BLOCKED_KIND_SET = new Set<number>(SOCIAL_KIND_BLOCKED_KINDS)

export function isSocialKindBlockedKind(kind: number): boolean {
  return SOCIAL_KIND_BLOCKED_KIND_SET.has(kind)
}

/**
 * True when a filter should avoid relays that do not carry social-note surface.
 *
 * Important: kindless lookup filters (e.g. `ids`, `authors + #d`, **`#p` mentions**, `#e` threads)
 * are scoped and must keep aggregators / read mirrors in scope. The notifications faux spell uses
 * `#p` only (kinds applied client-side); misclassifying it as a broad social firehose stripped every
 * relay and skipped real REQ batches (`groupedRequests.length === 0`).
 */
export function relayFilterIncludesSocialKindBlockedKind(filter: Filter): boolean {
  const k = filter.kinds
  if (k === undefined) {
    const ids = Array.isArray(filter.ids) ? filter.ids.length : 0
    const dTags = Array.isArray((filter as Record<string, unknown>)['#d'])
      ? ((filter as Record<string, unknown>)['#d'] as unknown[]).length
      : 0
    const pTags = Array.isArray((filter as Record<string, unknown>)['#p'])
      ? ((filter as Record<string, unknown>)['#p'] as unknown[]).length
      : 0
    const eTags = Array.isArray((filter as Record<string, unknown>)['#e'])
      ? ((filter as Record<string, unknown>)['#e'] as unknown[]).length
      : 0
    const eUpperTags = Array.isArray((filter as Record<string, unknown>)['#E'])
      ? ((filter as Record<string, unknown>)['#E'] as unknown[]).length
      : 0
    const aTags = Array.isArray((filter as Record<string, unknown>)['#a'])
      ? ((filter as Record<string, unknown>)['#a'] as unknown[]).length
      : 0
    const tTags = Array.isArray((filter as Record<string, unknown>)['#t'])
      ? ((filter as Record<string, unknown>)['#t'] as unknown[]).length
      : 0
    const authors = Array.isArray(filter.authors) ? filter.authors.length : 0
    const search = filter.search
    const hasSearch = typeof search === 'string' && search.trim().length > 0
    // Scoped lookups are not "broad social feed" queries.
    if (
      ids > 0 ||
      dTags > 0 ||
      pTags > 0 ||
      eTags > 0 ||
      eUpperTags > 0 ||
      aTags > 0 ||
      tTags > 0 ||
      authors > 0 ||
      hasSearch
    ) {
      return false
    }
    return true
  }
  const arr = Array.isArray(k) ? k : [k]
  return arr.some((kind) => SOCIAL_KIND_BLOCKED_KIND_SET.has(kind))
}

/**
 * Document/event kinds that should always include {@link DOCUMENT_RELAY_URLS} in read/publish relay candidates.
 */
const DOCUMENT_RELAY_KINDS: readonly number[] = [
  kinds.LongFormArticle, // 30023
  ExtendedKind.WIKI_ARTICLE, // 30818
  ExtendedKind.WIKI_ARTICLE_MARKDOWN, // 30817
  ExtendedKind.PUBLICATION_CONTENT, // 30041
  ExtendedKind.PUBLICATION // 30040
]

const DOCUMENT_RELAY_KIND_SET = new Set<number>(DOCUMENT_RELAY_KINDS)

export function isDocumentRelayKind(kind: number): boolean {
  return DOCUMENT_RELAY_KIND_SET.has(kind)
}

/**
 * Long-form, wiki, and publication kinds always included in NIP-50 / d-tag search REQ and progressive local warmup.
 * Kind 30041 (`PUBLICATION_CONTENT`) is deprioritized in `compareEventsForDTagQuery` unless the `d` tag is an exact
 * match (case-insensitive).
 */
export const NIP_SEARCH_DOCUMENT_KINDS: readonly number[] = [
  kinds.LongFormArticle,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT
]

/**
 * Primary Search page NIP-50 `kinds`: profiles, short notes, and document kinds.
 * Search used only {@link NIP_SEARCH_DOCUMENT_KINDS} before, so handles and npub-related
 * metadata (kind 0) and normal notes (kind 1) never matched.
 */
export const NIP_SEARCH_PAGE_KINDS: readonly number[] = Array.from(
  new Set<number>([kinds.Metadata, kinds.ShortTextNote, ...NIP_SEARCH_DOCUMENT_KINDS])
).sort((a, b) => a - b)

export function relayFilterIncludesDocumentRelayKind(filter: Filter): boolean {
  const k = filter.kinds
  if (k === undefined) return false
  const arr = Array.isArray(k) ? k : [k]
  return arr.some((kind) => DOCUMENT_RELAY_KIND_SET.has(kind))
}

/**
 * After dropping {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} from a relay stack: if every URL was removed but the caller
 * passed exactly one relay (e.g. a favorite-relay chip), keep it. Blended stacks still omit these relays; a
 * user-targeted single-relay feed should actually contact that relay (e.g. thecitadel for kinds the relay does carry).
 */
export function relaysAfterSocialKindBlockedStrip(
  originalDedupedUrls: string[],
  afterStrip: string[]
): string[] {
  if (afterStrip.length > 0) return afterStrip
  if (originalDedupedUrls.length === 1) return [...originalDedupedUrls]
  return afterStrip
}

/** Event kinds that show “Read this note aloud” in note options (Web Speech API). */
export const READ_ALOUD_KINDS: readonly number[] = [
  kinds.ShortTextNote,
  ExtendedKind.DISCUSSION,
  ExtendedKind.COMMENT,
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.WIKI_ARTICLE
]

/** NIP-52 calendar event kinds (addressable by d-tag); use in isReplaceableEvent. */
export const CALENDAR_EVENT_KINDS = [
  ExtendedKind.CALENDAR_EVENT_DATE,
  ExtendedKind.CALENDAR_EVENT_TIME
] as const

/**
 * NIP-52 calendar **note** kinds only: **31922** (date-based) and **31923** (time-based).
 * Excludes RSVP kind 31925. Prefer this or {@link CALENDAR_EVENT_KINDS} so UI stays aligned with NIP-52.
 */
export function isNip52CalendarCardKind(kind: number): boolean {
  return (CALENDAR_EVENT_KINDS as readonly number[]).includes(kind)
}

/** Maximum invitees for calendar event group invites (one kind 24 with all as p-tags). */
export const MAX_CALENDAR_INVITEES = 10

export const SUPPORTED_KINDS = [
  kinds.ShortTextNote,
  kinds.Repost,
  ExtendedKind.GENERIC_REPOST,
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VIDEO_ADDRESSABLE,
  ExtendedKind.POLL,
  ExtendedKind.ZAP_POLL,
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE,
  ExtendedKind.VOICE_COMMENT,
  // ExtendedKind.PUBLIC_MESSAGE, // Excluded - public messages should only appear in notifications
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.RELAY_REVIEW,
  ExtendedKind.DISCUSSION,
  ExtendedKind.ZAP_RECEIPT,
  ExtendedKind.CALENDAR_EVENT_DATE,
  ExtendedKind.CALENDAR_EVENT_TIME,
  /** NIP-53 live stream / radio ticker — shown in feed with inline play when tags allow. */
  kinds.LiveEvent,
  ExtendedKind.PUBLICATION,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  // ExtendedKind.PUBLICATION_CONTENT, // Excluded - publication content should only be embedded in publications
  // NIP-89 Application Handlers
  ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION,
  ExtendedKind.APPLICATION_HANDLER_INFO,
  ExtendedKind.GIT_REPO_ANNOUNCEMENT,
  ExtendedKind.GIT_ISSUE,
  ExtendedKind.GIT_RELEASE
]

/**
 * Kinds for profile-style feeds and the kind-filter UI (includes boosts). Excludes publications,
 * publication content, and NIP-89 handler kinds.
 */
export const PROFILE_FEED_KINDS = SUPPORTED_KINDS.filter(
  (k) =>
    k !== ExtendedKind.PUBLICATION &&
    k !== ExtendedKind.PUBLICATION_CONTENT &&
    k !== ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION &&
    k !== ExtendedKind.APPLICATION_HANDLER_INFO
)

/** Long-form, wiki, and publication index events for the profile "Articles and Publications" tab. */
export const PROFILE_PUBLICATIONS_TAB_KINDS: readonly number[] = [
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN
]

const PROFILE_PUBLICATIONS_TAB_KIND_SET = new Set<number>(PROFILE_PUBLICATIONS_TAB_KINDS)

/** NIP native media kinds for the profile Media tab (and Spells → media faux spell). */
export const PROFILE_MEDIA_TAB_KINDS: readonly number[] = [
  ExtendedKind.PICTURE,
  ...NIP71_VIDEO_KINDS,
  ExtendedKind.VOICE
]

const PROFILE_MEDIA_TAB_KIND_SET = new Set<number>(PROFILE_MEDIA_TAB_KINDS)

/**
 * Kinds subscribed on the profile Posts tab only. Omits publication kinds and native media kinds so those
 * events appear only on Articles/Publications and Media; {@link PROFILE_FEED_KINDS} is unchanged for the home
 * feed and kind-filter defaults.
 */
export const PROFILE_POSTS_TAB_KINDS: readonly number[] = PROFILE_FEED_KINDS.filter(
  (k) => !PROFILE_PUBLICATIONS_TAB_KIND_SET.has(k) && !PROFILE_MEDIA_TAB_KIND_SET.has(k)
)

/**
 * {@link PROFILE_FEED_KINDS} without reposts (kind 6 / 16). Default for the global kind filter, home feed,
 * and most faux spells. Reposts are still shown on profile timelines, Spells → Following, and Follows latest.
 */
export const DEFAULT_FEED_SHOW_KINDS = PROFILE_FEED_KINDS.filter(
  (k) =>
    k !== kinds.Repost &&
    k !== ExtendedKind.GENERIC_REPOST &&
    k !== ExtendedKind.GIT_REPO_ANNOUNCEMENT &&
    k !== ExtendedKind.GIT_ISSUE
)

/** Order for faux-spells in the feed / spell picker. */
export const FAUX_SPELL_ORDER = [
  'notifications',
  'discussions',
  'following',
  'heatMap',
  'topicMap',
  'followPacks',
  'media',
  'interests',
  'bookmarks',
  'calendar'
] as const

/**
 * Trailing lookahead must not be `(?=\\.)` alone: that matches between host labels (e.g. imwald . eu).
 * Use `\\.(?:\\s|$)` for sentence-ending dots; `,(?=/|\\s|$)` ends before a comma that is not part of a
 * comma-separated URL segment (e.g. typo `eu,/` or `eu, `).
 */
export const URL_REGEX =
  /https?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+(?:,[^\s.][\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,]*)*[^\s.,;:'")\]}!?，。；："'！？】）](?=\.(?:\s|$)|,\s|,(?=\/|\s|$)|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
export const WS_URL_REGEX =
  /wss?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+[^\s.,;:'")\]}!?，。；："'！？】）](?=\.(?:\s|$)|,\s|,(?=\/|\s|$)|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
/** @see {@link '@/lib/content-patterns'} — single source for emoji + nostr regexes */
export {
  EMBEDDED_EVENT_REGEX
} from '@/lib/content-patterns'
export const HASHTAG_REGEX = /#[a-zA-Z0-9_\-\u00C0-\u017F\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]+/g
export const LN_INVOICE_REGEX = /(ln(?:bc|tb|bcrt))([0-9]+[munp]?)?1([02-9ac-hj-np-z]+)/g
export const YOUTUBE_URL_REGEX =
  /https?:\/\/(?:(?:(?:www|m|music)\.)?youtube\.com\/(?:watch\?[^#\s]*|embed\/[\w-]+|shorts\/[\w-]+|live\/[\w-]+)|(?:www\.)?youtube-nocookie\.com\/(?:watch\?[^#\s]*|embed\/[\w-]+|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+)(?:\?[^#\s]*)?(?:#[^\s]*)?/gi

/** open.spotify.com track / album / playlist / episode / show (optional intl-xx segment). */
export const SPOTIFY_OPEN_URL_REGEX =
  /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:track|album|playlist|episode|show)\/[a-zA-Z0-9]+(?:\?[^\s#]*)?(?:#[^\s]*)?/gi

/** zap.stream live player: path must be a bare NIP-19 naddr (`/naddr1…`). */
export const ZAP_STREAM_WATCH_URL_REGEX =
  /https?:\/\/(?:www\.)?zap\.stream\/(naddr1[02-9ac-hj-np-z]+)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi

/** Maintainer / official zap recipient pubkey for this distribution. */
export const IMWALD_MAINTAINER_PUBKEY =
  'f4eb8e62add1340b9cadcd9861e669b2e907cea534e0f7f3ac974c11c758a51a'

export const CODY_PUBKEY = '8125b911ed0e94dbe3008a0be48cfe5cd0c0b05923cfff917ae7e87da8400883'
export const SILBERENGEL_PUBKEY = 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1'

export const NIP_96_SERVICE = [
  'https://mockingyou.com',
  'https://nostpic.com',
  'https://nostr.build', // default
  'https://nostrcheck.me',
  'https://nostrmedia.com',
  'https://files.sovbit.host'
]
export const DEFAULT_NIP_96_SERVICE = 'https://nostr.build'

export const DEFAULT_NOSTRCONNECT_RELAY = [
  'wss://relay.nsec.app/',
  'wss://bucket.coracle.social/',
  'wss://relay.primal.net/',
  'wss://thecitadel.nostr1.com/'
]

export const POLL_TYPE = {
  MULTIPLE_CHOICE: 'multiplechoice',
  SINGLE_CHOICE: 'singlechoice'
} as const

export const NOTIFICATION_LIST_STYLE = {
  COMPACT: 'compact',
  DETAILED: 'detailed'
} as const

export const MEDIA_AUTO_LOAD_POLICY = {
  ALWAYS: 'always',
  WIFI_ONLY: 'wifi-only',
  NEVER: 'never'
} as const

export const DEFAULT_RSS_FEEDS = ['https://divineoffice.org/feed/']
