import type { TRelaySet } from '@/types'

export const HOME_FEED_RELAY_SOURCE_FAVORITES = 'favorites'
export const HOME_FAVORITES_FEED_SUBSCRIPTION_KEY = 'home-all-favorites'
export const HOME_FAVORITES_FEED_TIMELINE_SCOPE_KEY = 'all-favorites'

export function homeRelaySetFeedSubscriptionKey(relaySetId: string): string {
  return `home-relay-set:${relaySetId}`
}

export function homeRelaySetFeedTimelineScopeKey(relaySetId: string): string {
  return `relay-set:${relaySetId}`
}

export function isHomePrimaryFeedSubscriptionKey(key: string | undefined): boolean {
  if (!key) return false
  return key === HOME_FAVORITES_FEED_SUBSCRIPTION_KEY || key.startsWith('home-relay-set:')
}

export function homeFeedSubscriptionKeys(source: string): {
  subscriptionKey: string
  timelineScopeKey: string
} {
  if (source === HOME_FEED_RELAY_SOURCE_FAVORITES) {
    return {
      subscriptionKey: HOME_FAVORITES_FEED_SUBSCRIPTION_KEY,
      timelineScopeKey: HOME_FAVORITES_FEED_TIMELINE_SCOPE_KEY
    }
  }
  return {
    subscriptionKey: homeRelaySetFeedSubscriptionKey(source),
    timelineScopeKey: homeRelaySetFeedTimelineScopeKey(source)
  }
}

export function resolveHomeFeedPrimaryRelayUrls(
  source: string,
  favoriteRelays: readonly string[],
  relaySets: readonly TRelaySet[]
): { urls: string[]; effectiveSource: string } {
  if (source === HOME_FEED_RELAY_SOURCE_FAVORITES) {
    return { urls: [...favoriteRelays], effectiveSource: HOME_FEED_RELAY_SOURCE_FAVORITES }
  }
  const set = relaySets.find((entry) => entry.id === source)
  if (set?.relayUrls.length) {
    return { urls: [...set.relayUrls], effectiveSource: source }
  }
  return { urls: [...favoriteRelays], effectiveSource: HOME_FEED_RELAY_SOURCE_FAVORITES }
}

export function homeFeedSourceLabel(
  source: string,
  relaySets: readonly TRelaySet[],
  t: (key: string) => string
): string {
  if (source === HOME_FEED_RELAY_SOURCE_FAVORITES) {
    return t('All favorite relays')
  }
  const set = relaySets.find((entry) => entry.id === source)
  return set?.name?.trim() || t('All favorite relays')
}

export function normalizeHomeFeedRelaySource(
  source: string | null | undefined,
  relaySets: readonly TRelaySet[]
): string {
  const trimmed = source?.trim()
  if (!trimmed || trimmed === HOME_FEED_RELAY_SOURCE_FAVORITES) {
    return HOME_FEED_RELAY_SOURCE_FAVORITES
  }
  return relaySets.some((set) => set.id === trimmed) ? trimmed : HOME_FEED_RELAY_SOURCE_FAVORITES
}
