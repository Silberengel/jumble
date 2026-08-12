import {
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  PROFILE_RELAY_URLS
} from '@/constants'
import { isProfileIndexOnlyRelay } from '@/lib/relay-publish-filter'
import { syntheticOriginalRelaysFromReadWrite } from '@/lib/relay-list-sanitize'
import { normalizeUrl } from '@/lib/url'
import type { TMailboxRelay } from '@/types'

export type ViewerRelayListLike = {
  read?: string[] | null
  write?: string[] | null
  httpRead?: string[] | null
} | null | undefined

/**
 * Use {@link DEFAULT_FAVORITE_RELAYS}, {@link FAST_READ_RELAY_URLS}, and {@link FAST_WRITE_RELAY_URLS} only when
 * the user is not signed in, or when they are signed in but have configured neither favorite relays nor a usable
 * NIP-65 / HTTP mailbox. Profile-index mirrors alone (purplepag.es, profiles.nostr1.com, …) do not count —
 * those are discovery targets, not general inboxes/outboxes.
 */
/** Public read mirrors used when relay lists are empty. */
export function publicReadRelayFallbackUrls(): readonly string[] {
  return FAST_READ_RELAY_URLS
}

/** True when the mailbox has at least one non–profile-index relay URL. */
export function relayListHasUsableMailboxUrls(relayList: ViewerRelayListLike): boolean {
  const urls = [
    ...(relayList?.read ?? []),
    ...(relayList?.write ?? []),
    ...(relayList?.httpRead ?? [])
  ].filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
  if (urls.length === 0) return false
  return urls.some((u) => !isProfileIndexOnlyRelay(u))
}

export function viewerUsesGlobalRelayDefaults(args: {
  viewerPubkey: string | null | undefined
  favoriteRelayUrls: readonly string[]
  relayList: ViewerRelayListLike
}): boolean {
  if (!args.viewerPubkey?.trim()) return true
  const hasFavorites = args.favoriteRelayUrls.some((u) => typeof u === 'string' && u.trim().length > 0)
  const hasNip65 = relayListHasUsableMailboxUrls(args.relayList)
  return !(hasFavorites || hasNip65)
}

const fastReadKeySet = (): Set<string> => {
  const s = new Set<string>()
  for (const u of FAST_READ_RELAY_URLS) {
    const n = (normalizeUrl(u) || u).toLowerCase()
    if (n) s.add(n)
  }
  return s
}

/** PROFILE_FETCH stack with {@link FAST_READ_RELAY_URLS} entries removed (order preserved). */
export function profileFetchRelayUrlsWithoutFastReadLayer(): string[] {
  const drop = fastReadKeySet()
  return PROFILE_RELAY_URLS.filter((u) => {
    const n = (normalizeUrl(u) || u).toLowerCase()
    return n && !drop.has(n)
  })
}

export function defaultFavoriteRelaysForViewer(useGlobalDefaults: boolean): string[] {
  return useGlobalDefaults ? [...DEFAULT_FAVORITE_RELAYS] : []
}

export type MailboxRelayListFallback = {
  write: string[]
  read: string[]
  originalRelays: TMailboxRelay[]
  httpRead: string[]
  httpWrite: string[]
  httpOriginalRelays: TMailboxRelay[]
}

/**
 * Logged-in viewer with no usable kind 10002: seed mailbox UI + stacks from
 * {@link FAST_READ_RELAY_URLS} / {@link FAST_WRITE_RELAY_URLS} (not profile-index mirrors).
 */
export function viewerMissingRelayListFallback(): MailboxRelayListFallback {
  const read = [...FAST_READ_RELAY_URLS]
  const write = [...FAST_WRITE_RELAY_URLS]
  return {
    read,
    write,
    originalRelays: syntheticOriginalRelaysFromReadWrite(read, write),
    httpRead: [],
    httpWrite: [],
    httpOriginalRelays: []
  }
}

/** Absolute last resort when even merge helpers throw. */
export function emptyMailboxRelayListFallback(): MailboxRelayListFallback {
  return {
    write: [],
    read: [],
    originalRelays: [],
    httpRead: [],
    httpWrite: [],
    httpOriginalRelays: []
  }
}

/**
 * Other authors with no usable kind 10002: public read + fast write for network,
 * without synthetic mailbox rows (profile UI must not invent a published list).
 */
export function remoteAuthorMissingRelayListFallback(): MailboxRelayListFallback {
  return {
    write: [...FAST_WRITE_RELAY_URLS],
    read: [...publicReadRelayFallbackUrls()],
    originalRelays: [],
    httpRead: [],
    httpWrite: [],
    httpOriginalRelays: []
  }
}
