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

/** Coalesce live `onNew` merges into one emit per burst (matches NoteList). */
export const HOME_FEED_LIVE_ON_NEW_FLUSH_MS = 72

/**
 * Cap local + archive prime scans. Session snapshot already paints when present; deep scans
 * compete with first relay paint on the main thread.
 */
export const HOME_FEED_LOCAL_PRIME_MAX_ROWS_SCANNED = 8_000

/** Skip archive prime when session/local already produced at least this many rows. */
export const HOME_FEED_SKIP_ARCHIVE_PRIME_MIN_ROWS = 40

/** Keep skeleton until first events, wave-complete, or this safety deadline. */
export const HOME_FEED_LOADING_SAFETY_MS = 15_000

/** Estimated NoteCard height for virtualizer overscan (px). */
export const HOME_FEED_VIRTUAL_ESTIMATE_SIZE_PX = 220

export const HOME_FEED_VIRTUAL_OVERSCAN = 6
