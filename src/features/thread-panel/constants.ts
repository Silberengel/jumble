export const THREAD_REPLY_LIMIT = 200
export const THREAD_REPLY_SHOW_COUNT = 10
export const MAX_PARENT_IDS_PER_NESTED_REQ = 64
export const THREAD_PROFILE_BATCH_DEBOUNCE_MS = 120
export const THREAD_PROFILE_CHUNK = 80

/** User-initiated missing-reply search: hard cap so the button does not spin for minutes. */
export const MISSING_THREAD_REPLY_SEARCH_TIMEOUT_MS = 14_000
export const MISSING_THREAD_REPLY_SEARCH_RELAY_TIMEOUT_MS = 10_000

/** In-memory thread reply cache TTL (replaces discussion-feed-cache thread rows). */
export const THREAD_PANEL_CACHE_TTL_MS = 5 * 60 * 1000
export const THREAD_PANEL_CACHE_MAX_KEYS = 100
