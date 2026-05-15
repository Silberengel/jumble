import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'

/** @returns true when the app may merge FAST_READ / FAST_WRITE / DEFAULT_FAVORITE bootstrap relays. */
export function useGlobalRelayBootstrapDefaults(): boolean {
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  return viewerUsesGlobalRelayDefaults({
    viewerPubkey: pubkey,
    favoriteRelayUrls: favoriteRelays,
    relayList
  })
}
