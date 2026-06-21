import { StorageKey } from '@/constants'

/** localStorage keys no longer read by the app (removed features or migrated settings). */
export const OBSOLETE_LOCAL_STORAGE_KEYS: readonly string[] = [
  'showRssFeed',
  'mediaUploadService',
  'useNostrArchivesApi',
  'showRecommendedRelaysPanel',
  StorageKey.NOTIFICATION_TYPE,
  'noteListMode',
  StorageKey.HIDE_UNTRUSTED_EVENTS,
  StorageKey.SHOW_REPLIES_AND_COMMENTS,
  StorageKey.ACCOUNT_PROFILE_EVENT_MAP,
  StorageKey.ACCOUNT_FOLLOW_LIST_EVENT_MAP,
  StorageKey.ACCOUNT_RELAY_LIST_EVENT_MAP,
  StorageKey.ACCOUNT_MUTE_LIST_EVENT_MAP,
  StorageKey.ACCOUNT_MUTE_DECRYPTED_TAGS_MAP,
  StorageKey.ACTIVE_RELAY_SET_ID,
  StorageKey.FEED_TYPE,
  StorageKey.RESTRICT_RELAYS_TO_METADATA_LISTS
]

/** IndexedDB `settings` rows from removed RSS+Web feed UI and other dead prefs. */
export const OBSOLETE_INDEXEDDB_SETTING_KEYS: readonly string[] = [
  'rssWebSuppressClawstrLinks',
  'rssWebHideUnifiedClutter',
  'rssWebFeedScope',
  'rssWebManualUrls',
  'rssWebPromotedThreadUrls',
  'rssFeedFetchAttemptedKeys',
  StorageKey.NOTIFICATION_TYPE,
  'noteListMode'
]

export function purgeObsoleteLocalStorageKeys(): void {
  for (const key of OBSOLETE_LOCAL_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // private browsing / quota
    }
  }
}

export async function purgeObsoleteIndexedDbSettings(
  deleteSetting: (key: string) => Promise<void>
): Promise<void> {
  await Promise.all(
    OBSOLETE_INDEXEDDB_SETTING_KEYS.map((key) =>
      deleteSetting(key).catch(() => {})
    )
  )
}
