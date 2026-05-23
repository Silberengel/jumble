import {
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  PROFILE_RELAY_URLS
} from '@/constants'
import { normalizeUrl } from '@/lib/url'

export type ViewerRelayListLike = {
  read?: string[] | null
  write?: string[] | null
  httpRead?: string[] | null
} | null | undefined

/**
 * Use {@link DEFAULT_FAVORITE_RELAYS}, {@link FAST_READ_RELAY_URLS}, and {@link FAST_WRITE_RELAY_URLS} only when
 * the user is not signed in, or when they are signed in but have configured neither favorite relays nor a NIP-65
 * (kind 10002 / HTTP index) relay list. Otherwise REQ/publish stacks should stay on their own relays.
 */
/** Public read mirrors used when relay lists are empty. */
export function publicReadRelayFallbackUrls(): readonly string[] {
  return FAST_READ_RELAY_URLS
}

export function viewerUsesGlobalRelayDefaults(args: {
  viewerPubkey: string | null | undefined
  favoriteRelayUrls: readonly string[]
  relayList: ViewerRelayListLike
}): boolean {
  if (!args.viewerPubkey?.trim()) return true
  const hasFavorites = args.favoriteRelayUrls.some((u) => typeof u === 'string' && u.trim().length > 0)
  const rl = args.relayList
  const hasNip65 =
    (rl?.read?.length ?? 0) > 0 ||
    (rl?.write?.length ?? 0) > 0 ||
    (rl?.httpRead?.length ?? 0) > 0
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
