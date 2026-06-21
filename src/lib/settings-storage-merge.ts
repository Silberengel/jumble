import { StorageKey } from '@/constants'
import {
  mergeAccountsSettingsJson,
  mergeCurrentAccountSettingsJson
} from '@/lib/account-secrets'

/**
 * Merge IndexedDB settings with localStorage. Auth keys use secret-aware merge; other keys prefer
 * localStorage when set so synchronous writes survive slow/failed IDB on mobile PWA.
 */
export function mergeSettingsRecordWithLocalStorage(
  idb: Record<string, string>,
  settingsKeys: readonly string[],
  getLocalStorage: (key: string) => string | null
): Record<string, string> {
  const out: Record<string, string> = { ...idb }
  for (const key of settingsKeys) {
    const fromLs = getLocalStorage(key)
    if (key === StorageKey.ACCOUNTS) {
      const merged = mergeAccountsSettingsJson(out[key], fromLs ?? undefined)
      if (merged != null) out[key] = merged
      continue
    }
    if (key === StorageKey.CURRENT_ACCOUNT) {
      const merged = mergeCurrentAccountSettingsJson(out[key], fromLs ?? undefined)
      if (merged != null) out[key] = merged
      continue
    }
    if (fromLs != null) {
      out[key] = fromLs
    }
  }
  return out
}
