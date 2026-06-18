/** Per-shard REQ limit for home timeline + load-more. */
export const HOME_FEED_PAGE_LIMIT = 150

/** Home feed: auto-refresh when the newest visible note is older than this. */
export const STALE_HOME_FEED_MAX_AGE_SEC = 4 * 3600

export const STALE_HOME_FEED_REFRESH_COOLDOWN_MS = 10 * 60 * 1000

/** Initial visible rows; load-more reveals in batches. */
export const HOME_FEED_INITIAL_SHOW_COUNT = 25

export const HOME_FEED_REVEAL_BATCH = 64

/** Max events kept in memory for the home feed stream. */
export const HOME_FEED_EVENT_CAP = 500

/** Consecutive empty load-more pages before marking exhausted. */
export const HOME_FEED_EMPTY_PAGE_THRESHOLD = 15

export const HOME_FEED_MAX_LOAD_MORE_PAGES = 12
