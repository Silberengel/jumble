import logger from '@/lib/logger'
import { promiseWithTimeout } from '@/lib/async-timeout'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { TRelayList } from '@/types'

const APP_CACHE_NAMES = ['nostr-images', 'satellite-images', 'external-images'] as const

function isAppRelatedCacheName(name: string, origin: string): boolean {
  if ((APP_CACHE_NAMES as readonly string[]).includes(name)) return true
  if (name.startsWith('workbox-') || name.startsWith('precache-')) return true
  const host = origin.replace(/https?:\/\//, '').split('/')[0]
  return name.includes(host)
}

export type ClearAppServiceWorkerResult = {
  unregisteredCount: number
  cacheClearedCount: number
}

export async function clearAppPrecacheCaches(): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0

  let cleared = 0
  try {
    const cacheNames = await caches.keys()
    const origin = window.location.origin
    const appCaches = cacheNames.filter((name) => isAppRelatedCacheName(name, origin))
    await Promise.all(
      appCaches.map((name) =>
        caches
          .delete(name)
          .then((ok) => {
            if (ok) cleared++
          })
          .catch((error) => {
            logger.warn('[app-cache] Failed to delete cache', { name, error })
          })
      )
    )
  } catch (error) {
    logger.warn('[app-cache] Failed to clear precache caches', { error })
  }
  return cleared
}

export async function unregisterAppServiceWorkers(): Promise<number> {
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) {
    return 0
  }

  let count = 0
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const origin = window.location.origin
    await Promise.all(
      registrations.map(async (registration) => {
        if (!registration.scope.startsWith(origin)) return
        try {
          if (await registration.unregister()) count++
        } catch (error) {
          logger.warn('[app-cache] Failed to unregister service worker', { error })
        }
      })
    )
  } catch (error) {
    logger.warn('[app-cache] Failed to get service worker registrations', { error })
  }
  return count
}

export async function clearAppServiceWorkerAndCaches(): Promise<ClearAppServiceWorkerResult> {
  const cacheClearedCount = await clearAppPrecacheCaches()
  const unregisteredCount = await unregisterAppServiceWorkers()
  return { unregisteredCount, cacheClearedCount }
}

export type RefreshAppBrowserCacheOptions = {
  pubkey?: string | null
  relayList?: TRelayList | null
  requestAccountNetworkHydrate?: () => Promise<void>
}

export async function refreshAppBrowserCache(options?: RefreshAppBrowserCacheOptions): Promise<void> {
  await indexedDb.forceDatabaseUpgrade()
  const pubkey = options?.pubkey?.trim()
  if (pubkey && options?.requestAccountNetworkHydrate) {
    await options.requestAccountNetworkHydrate()
    await promiseWithTimeout(
      client.refreshAuthorPublishedReplaceablesOnProfileView(pubkey, { force: true }),
      20_000,
      'refreshAuthorPublishedReplaceablesOnProfileView'
    ).catch((error) => {
      logger.debug('[app-cache] Author replaceables refresh after cache refresh timed out or failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    })
    await syncUserDeletionTombstones(pubkey, options.relayList ?? null)
  }
}

/** IndexedDB refresh + service worker unregister + Cache API clear (settings / update banner). */
export async function refreshAppBrowserCacheAndClearServiceWorker(
  options?: RefreshAppBrowserCacheOptions
): Promise<ClearAppServiceWorkerResult> {
  await refreshAppBrowserCache(options)
  return clearAppServiceWorkerAndCaches()
}
