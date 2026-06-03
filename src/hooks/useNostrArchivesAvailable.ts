import nostrArchivesApi from '@/services/nostr-archives-api.service'
import { useSyncExternalStore } from 'react'

/** Re-render when Archives API availability may change (settings / circuit breaker). */
export function useNostrArchivesAvailable(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => nostrArchivesApi.subscribeAvailability(onStoreChange),
    () => nostrArchivesApi.isAvailable(),
    () => false
  )
}
