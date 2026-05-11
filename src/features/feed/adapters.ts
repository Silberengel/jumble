import type { TFeedSubRequest } from '@/types'
import { createFeedDescriptor, type FeedDescriptor, type FeedDescriptorInput, type FeedSurface } from './descriptor'

type FeedAdapterOptions = {
  id?: string
  live?: boolean
  view?: FeedDescriptorInput['view']
  source?: FeedDescriptorInput['source']
  pagination?: FeedDescriptorInput['pagination']
}

export function descriptorFromSubRequests(args: {
  surface: FeedSurface
  id?: string
  requests: readonly TFeedSubRequest[]
  live?: boolean
  view?: FeedDescriptorInput['view']
  source?: FeedDescriptorInput['source']
  pagination?: FeedDescriptorInput['pagination']
}): FeedDescriptor {
  return createFeedDescriptor({
    surface: args.surface,
    id: args.id,
    mode: args.live === false ? 'one-shot' : 'live',
    requests: args.requests,
    view: args.view,
    source: args.source,
    pagination: args.pagination
  })
}

function surfaceDescriptor(
  surface: FeedSurface,
  requests: readonly TFeedSubRequest[],
  defaults: FeedAdapterOptions,
  options: FeedAdapterOptions = {}
): FeedDescriptor {
  return descriptorFromSubRequests({
    surface,
    id: options.id ?? defaults.id,
    requests,
    live: options.live ?? defaults.live,
    view: { ...defaults.view, ...options.view },
    source: { ...defaults.source, ...options.source },
    pagination: { ...defaults.pagination, ...options.pagination }
  })
}

export function homeFeedDescriptor(requests: readonly TFeedSubRequest[], id = 'home'): FeedDescriptor {
  return descriptorFromSubRequests({
    surface: 'home',
    id,
    requests,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  })
}

export function favoritesFeedDescriptor(requests: readonly TFeedSubRequest[], id = 'favorites'): FeedDescriptor {
  return surfaceDescriptor('favorites', requests, {
    id,
    source: { cache: 'stale-while-refresh' },
    pagination: { enabled: true }
  })
}

export function relayFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  relayUrl: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('relay', requests, {
    id: relayUrl,
    source: { cache: 'stale-while-refresh', preserveRowsOnRelayChange: true },
    pagination: { enabled: true }
  }, options)
}

export function relaySetFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('relay-set', requests, {
    id,
    source: { cache: 'stale-while-refresh', preserveRowsOnRelayChange: true },
    pagination: { enabled: true }
  }, options)
}

export function profileFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  pubkey: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('profile', requests, {
    id: pubkey,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function profileMediaFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  pubkey: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('profile-media', requests, {
    id: pubkey,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function profilePublicationsFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  pubkey: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('profile-publications', requests, {
    id: pubkey,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function notificationsFeedDescriptor(requests: readonly TFeedSubRequest[]): FeedDescriptor {
  return descriptorFromSubRequests({
    surface: 'notifications',
    id: 'notifications',
    requests,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  })
}

export function spellsFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'spells',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('spells', requests, {
    id,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function repliesFeedDescriptor(requests: readonly TFeedSubRequest[], id: string): FeedDescriptor {
  return descriptorFromSubRequests({
    surface: 'replies',
    id,
    requests,
    live: false,
    source: { cache: 'stale-while-refresh' },
    pagination: { enabled: false }
  })
}

export function threadFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('thread', requests, {
    id,
    live: false,
    source: { cache: 'stale-while-refresh' },
    pagination: { enabled: false }
  }, options)
}

export function embedFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('embed', requests, {
    id,
    live: false,
    source: { cache: 'fresh-required', publicReadFallback: true },
    pagination: { enabled: false }
  }, options)
}

export function searchFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('search', requests, {
    id,
    live: false,
    source: { cache: 'fresh-required', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function hashtagFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  tag: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('hashtag', requests, {
    id: tag,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function calendarFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'calendar',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('calendar', requests, {
    id,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function relayReviewsFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'relay-reviews',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('relay-reviews', requests, {
    id,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function bookmarksFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'bookmarks',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('bookmarks', requests, {
    id,
    source: { cache: 'stale-while-refresh' },
    pagination: { enabled: true }
  }, options)
}

export function pinsFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'pins',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('pins', requests, {
    id,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function interestsFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id = 'interests',
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('interests', requests, {
    id,
    source: { cache: 'stale-while-refresh', publicReadFallback: true },
    pagination: { enabled: true }
  }, options)
}

export function customFeedDescriptor(
  requests: readonly TFeedSubRequest[],
  id: string,
  options?: FeedAdapterOptions
): FeedDescriptor {
  return surfaceDescriptor('custom', requests, {
    id,
    source: { cache: 'stale-while-refresh' },
    pagination: { enabled: true }
  }, options)
}
