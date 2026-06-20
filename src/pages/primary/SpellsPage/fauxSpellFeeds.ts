/**
 * Built-in “faux spells”: same NoteList + filters as kind-777 spells. The Spells page uses live
 * `subscribeTimeline` (same as Following) so the first relay results stream in immediately instead of
 * waiting for every relay to EOSE on a one-shot query.
 *
 * **Why faux feeds can feel slow:** each timeline shard opens live REQs over the prioritized relay
 * stack (see {@link applyFauxSpellCapsToSubRequests}). Read-only mirrors are **prepended** in
 * {@link appendCuratedReadOnlyRelays} so the per-shard relay cap still includes aggregators (otherwise
 * inbox+favorites fill the cap and global kinds/media/hashtags never hit aggr). The **interests** spell
 * uses **one** shard: all subscribed topics in one `#t` filter (NIP-01 OR semantics).
 */
import {
  DEFAULT_FEED_SHOW_KINDS,
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  PROFILE_MEDIA_TAB_KINDS,
  READ_ONLY_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { RENDERABLE_NOTE_KINDS_SORTED } from '@/lib/note-renderable-kinds'
import { buildProfileAugmentedReadRelayUrls, getRelayUrlsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeTopic } from '@/lib/discussion-topics'
import {
  chunkArray,
  extractACoordsForNotificationReq,
  extractEHexIdsForNotificationReq,
  NOTIFICATION_THREAD_WATCH_A_CHUNK,
  NOTIFICATION_THREAD_WATCH_E_CHUNK,
  parseThreadWatchListRefs
} from '@/lib/notification-thread-watch'
import { userIdToPubkey } from '@/lib/pubkey'
import { pinHttpIndexRelaysInRelayCap, pinMentionRelaysInRelayCap } from '@/lib/feed-relay-urls'
import { pinMoneroNostrRelaysInRelayCap } from '@/lib/monero-nostr-relays'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest } from '@/types'
import { type Event, type Filter } from 'nostr-tools'

/** Default caps for every faux spell feed (relays per subrequest, events per REQ). */
export const FAUX_SPELL_MAX_RELAYS = 10
export const FAUX_SPELL_EVENT_LIMIT = 200

/** Minimum global mention/index relays pinned for the notifications spell (`#p` REQ). */
export const NOTIFICATION_MENTION_RELAY_PIN_COUNT = 5

/** Relays that index `#p` mentions and recent social events for the notifications spell. */
export function notificationMentionIndexRelayUrls(): string[] {
  return dedupeNormalizeRelayUrlsOrdered([
    ...FAST_READ_RELAY_URLS,
    ...SEARCHABLE_RELAY_URLS,
    ...READ_ONLY_RELAY_URLS
  ])
}

/**
 * Notifications need global mention aggregators, not only the viewer's NIP-65 inbox (which may not store `#p`).
 * Pins {@link NOTIFICATION_MENTION_RELAY_PIN_COUNT} index relays under {@link FAUX_SPELL_MAX_RELAYS}.
 */
export function buildNotificationSpellRelayUrls(
  personalUrls: readonly string[],
  blockedRelays: readonly string[] = []
): string[] {
  const blocked = new Set(
    blockedRelays
      .map((b) => (normalizeAnyRelayUrl(b) || b.trim()).toLowerCase())
      .filter(Boolean)
  )
  const allow = (u: string) => !blocked.has((normalizeAnyRelayUrl(u) || u.trim()).toLowerCase())
  const mentionIndex = notificationMentionIndexRelayUrls().filter(allow)
  const personal = dedupeNormalizeRelayUrlsOrdered([...personalUrls]).filter(allow)
  const capped = feedRelayPolicyUrls(
    [
      { source: 'search', urls: mentionIndex },
      { source: 'viewer-read', urls: personal }
    ],
    {
      operation: 'read',
      maxRelays: FAUX_SPELL_MAX_RELAYS,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
  return pinMoneroNostrRelaysInRelayCap(
    pinMentionRelaysInRelayCap(
      capped,
      mentionIndex,
      FAUX_SPELL_MAX_RELAYS,
      Math.min(NOTIFICATION_MENTION_RELAY_PIN_COUNT, mentionIndex.length)
    ),
    FAUX_SPELL_MAX_RELAYS
  )
}

/** Profile Media tab: single REQ `limit` (matches merged cap in NoteList one-shot). */
export const PROFILE_MEDIA_REQ_LIMIT = 200

/** Max relay URLs per Medien REQ (author stack + aggregators; see {@link buildProfileMediaSubRequests}). */
export const PROFILE_MEDIA_MAX_RELAYS = 16

/**
 * Trim relay lists and filter limits (and bookmark `ids`) so faux feeds stay cheap to open.
 */
export function applyFauxSpellCapsToSubRequests(requests: TFeedSubRequest[]): TFeedSubRequest[] {
  return requests.map((r) => {
    const urls = r.urls.slice(0, FAUX_SPELL_MAX_RELAYS)
    const f = { ...r.filter }
    const prevLimit = f.limit
    f.limit =
      typeof prevLimit === 'number' && prevLimit > 0
        ? Math.min(prevLimit, FAUX_SPELL_EVENT_LIMIT)
        : FAUX_SPELL_EVENT_LIMIT
    if (Array.isArray(f.ids) && f.ids.length > FAUX_SPELL_EVENT_LIMIT) {
      f.ids = f.ids.slice(0, FAUX_SPELL_EVENT_LIMIT)
    }
    return { ...r, urls, filter: f }
  })
}

/**
 * Same kinds as {@link RENDERABLE_NOTE_KINDS_SORTED}, plus NIP-41 collaborative edit proposals (kind 1010).
 * Live notifications REQ uses `#p` only (no relay `kinds`); this list is applied in NoteList via
 * `clientSideKindFilter` so only supported cards appear.
 */
export const NOTIFICATION_SPELL_KINDS = [...RENDERABLE_NOTE_KINDS_SORTED, ExtendedKind.SHORT_NOTE_EDIT].sort(
  (a, b) => a - b
)

/** Live notifications spell: longer than NoteList’s default 15s before empty state (slow `#p` on some relays). */
export const NOTIFICATION_SPELL_LOADING_SAFETY_MS = 90_000

/**
 * Max base topics from the interest list. Each base topic expands to singular+plural variants.
 */
const INTERESTS_MAX_TOPICS = 80

/**
 * Max distinct `t` tag values in one filter after case + singular/plural expansion.
 */
const INTERESTS_MAX_TOPIC_TAG_VALUES = INTERESTS_MAX_TOPICS * 4

/**
 * {@link buildPrioritizedReadRelayUrls} merges inbox → favorites → FAST_READ under {@link FAUX_SPELL_MAX_RELAYS}.
 * Long NIP-65 read lists can fill the cap before FAST_READ is reached, so every REQ shard was only dead/private
 * relays — live faux feeds (media, etc.) stayed empty while the console showed only connection refused.
 */
export function ensureFauxSpellRelayStackTouchesFastRead(urls: string[]): string[] {
  const sourceUrls = dedupeNormalizeRelayUrlsOrdered(urls)
  const fast = dedupeNormalizeRelayUrlsOrdered(
    FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )
  const fastNormSet = new Set<string>()
  for (const u of fast) {
    const n = normalizeAnyRelayUrl(u) || u.trim()
    if (n) fastNormSet.add(n)
  }
  const out = feedRelayPolicyUrls([{ source: 'fallback', urls: sourceUrls }], {
    operation: 'read',
    maxRelays: FAUX_SPELL_MAX_RELAYS,
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
  if (!out.length) return fast.slice(0, FAUX_SPELL_MAX_RELAYS)

  const fastCount = () =>
    out.reduce((n, u) => {
      const k = normalizeAnyRelayUrl(u) || u.trim()
      return n + (k && fastNormSet.has(k) ? 1 : 0)
    }, 0)

  while (fastCount() < 2) {
    let addedOne = false
    for (const fr of fast) {
      const fn = normalizeAnyRelayUrl(fr) || fr.trim()
      if (!fn || out.some((u) => (normalizeAnyRelayUrl(u) || u.trim()) === fn)) continue
      while (out.length >= FAUX_SPELL_MAX_RELAYS) {
        let dropped = false
        for (let i = out.length - 1; i >= 0; i--) {
          const kn = normalizeAnyRelayUrl(out[i]!) || out[i]!.trim()
          if (kn && !fastNormSet.has(kn)) {
            out.splice(i, 1)
            dropped = true
            break
          }
        }
        if (!dropped) break
      }
      out.push(fr)
      addedOne = true
      break
    }
    if (!addedOne) break
  }
  const capped = feedRelayPolicyUrls([{ source: 'fallback', urls: dedupeNormalizeRelayUrlsOrdered(out) }], {
    operation: 'read',
    maxRelays: FAUX_SPELL_MAX_RELAYS,
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
  return pinHttpIndexRelaysInRelayCap(capped, sourceUrls, FAUX_SPELL_MAX_RELAYS)
}

/** Max relay URLs for calendar month view + sidebar widget. */
export const CALENDAR_READ_MAX_RELAYS = 24

/**
 * Calendar reads: inbox → favorites → {@link FAST_READ_RELAY_URLS}, with fast-read pinning.
 * Optional read-only mirrors for the full calendar page (sidebar skips them to avoid idle sockets).
 */
export function buildCalendarReadRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[],
  userWriteRelays: string[],
  options?: { includeReadOnlyMirrors?: boolean }
): string[] {
  const base = ensureFauxSpellRelayStackTouchesFastRead(
    getRelayUrlsWithFavoritesFastReadAndInbox(
      favoriteRelays,
      blockedRelays,
      userInboxReadRelays,
      {
        userWriteRelays,
        applySocialKindBlockedFilter: false
      }
    )
  )
  if (!options?.includeReadOnlyMirrors) {
    return base.slice(0, CALENDAR_READ_MAX_RELAYS)
  }
  const mirrors = dedupeNormalizeRelayUrlsOrdered(
    READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )
  const merged = feedRelayPolicyUrls(
    [
      { source: 'read-only', urls: mirrors },
      { source: 'fallback', urls: base }
    ],
    {
      operation: 'read',
      maxRelays: CALENDAR_READ_MAX_RELAYS,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
  return ensureFauxSpellRelayStackTouchesFastRead(merged)
}

/** Dedupe curated read relays and drop user-blocked URLs (no {@link READ_ONLY_RELAY_URLS} prepend). */
export function appendCuratedReadOnlyRelays(curated: string[], blockedRelays: string[]): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeAnyRelayUrl(b) || b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of curated) {
    const k = normalizeAnyRelayUrl(u) || u
    if (!k || blocked.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** NIP-style native media kinds only — same as {@link PROFILE_MEDIA_TAB_KINDS}. */
export const MEDIA_SPELL_KINDS = PROFILE_MEDIA_TAB_KINDS

function normalizeMentionPubkey(pubkey: string): string {
  return /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
}

/** Notifications faux spell: `#p` = you, narrow kinds — see module docstring. */
export function buildMentionsSpellFilter(pubkey: string): Filter {
  const pk = normalizeMentionPubkey(pubkey)
  return {
    kinds: [...NOTIFICATION_SPELL_KINDS],
    limit: FAUX_SPELL_EVENT_LIMIT,
    '#p': [pk]
  }
}

/** Live timeline: one REQ per relay set, any kind with `#p` = you; kinds narrowed in the client. */
export function buildNotificationsSpellSubRequests(urls: string[], pubkey: string): TFeedSubRequest[] {
  const pk = normalizeMentionPubkey(pubkey)
  return [{ urls, filter: { limit: FAUX_SPELL_EVENT_LIMIT, '#p': [pk] } }]
}

/**
 * Extra shards: events referencing followed thread roots via `#e` / `#a` (OR within each filter).
 * Merged with {@link buildNotificationsSpellSubRequests} in the notifications faux spell.
 */
export function buildNotificationsFollowedThreadSubRequests(
  urls: string[],
  followListEvent: Event | null | undefined
): TFeedSubRequest[] {
  if (!urls.length) return []
  const refs = parseThreadWatchListRefs(followListEvent ?? null)
  const kinds = [...NOTIFICATION_SPELL_KINDS]
  const out: TFeedSubRequest[] = []
  for (const chunk of chunkArray(extractEHexIdsForNotificationReq(refs), NOTIFICATION_THREAD_WATCH_E_CHUNK)) {
    if (chunk.length === 0) continue
    out.push({ urls, filter: { kinds, limit: FAUX_SPELL_EVENT_LIMIT, '#e': chunk } })
  }
  for (const chunk of chunkArray(extractACoordsForNotificationReq(refs), NOTIFICATION_THREAD_WATCH_A_CHUNK)) {
    if (chunk.length === 0) continue
    out.push({ urls, filter: { kinds, limit: FAUX_SPELL_EVENT_LIMIT, '#a': chunk } })
  }
  return out
}

export function buildDiscussionFilter(): Filter {
  return {
    kinds: [ExtendedKind.DISCUSSION],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

/**
 * Kind 11 threads are often published to {@link FAST_WRITE_RELAY_URLS} (nos.lol, primal, …).
 * The generic faux-spell read stack only merges inbox + favorites + {@link FAST_READ_RELAY_URLS}, which
 * missed write-tier relays the legacy Discussions page always queried.
 */
export function buildDiscussionsSpellRelayUrls(
  personalUrls: readonly string[],
  blockedRelays: readonly string[] = []
): string[] {
  const blocked = new Set(
    blockedRelays
      .map((b) => (normalizeAnyRelayUrl(b) || b.trim()).toLowerCase())
      .filter(Boolean)
  )
  const allow = (u: string) => !blocked.has((normalizeAnyRelayUrl(u) || u.trim()).toLowerCase())
  const personal = dedupeNormalizeRelayUrlsOrdered([...personalUrls]).filter(allow)
  const writeLayer = dedupeNormalizeRelayUrlsOrdered(
    FAST_WRITE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  ).filter(allow)
  const capped = feedRelayPolicyUrls(
    [
      { source: 'viewer-read', urls: personal },
      { source: 'fast-write', urls: writeLayer }
    ],
    {
      operation: 'read',
      maxRelays: FAUX_SPELL_MAX_RELAYS,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
  return ensureFauxSpellRelayStackTouchesFastRead(capped)
}

export function buildMediaSpellFilter(): Filter {
  return { kinds: [...MEDIA_SPELL_KINDS], limit: FAUX_SPELL_EVENT_LIMIT }
}

/** Media kinds for a single profile ({@link PROFILE_MEDIA_TAB_KINDS}, scoped by `authors`). */
export function buildProfileMediaSpellFilter(pubkey: string): Filter {
  const decoded = userIdToPubkey(pubkey.trim())
  const pk = /^[0-9a-f]{64}$/i.test(decoded) ? decoded.toLowerCase() : pubkey.trim().toLowerCase()
  return {
    authors: [pk],
    kinds: [...PROFILE_MEDIA_TAB_KINDS],
    limit: PROFILE_MEDIA_REQ_LIMIT
  }
}

/**
 * Author inboxes/outboxes + read-only + fast read (see {@link buildProfileAugmentedReadRelayUrls}), capped at
 * {@link PROFILE_MEDIA_MAX_RELAYS}.
 */
export function buildProfileMediaSubRequests(
  authorRelayUrls: string[],
  blockedRelays: string[],
  pubkey: string
): TFeedSubRequest[] {
  const urls = buildProfileAugmentedReadRelayUrls(authorRelayUrls, blockedRelays, PROFILE_MEDIA_MAX_RELAYS)
  if (!urls.length) return []
  return [{ urls, filter: buildProfileMediaSpellFilter(pubkey) }]
}

export function buildCalendarSpellFilter(): Filter {
  return {
    kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

export function buildNostrSpecsSpellFilter(): Filter {
  return {
    kinds: [ExtendedKind.NOSTR_SPECIFICATION],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

function pluralizeTopic(topic: string): string {
  if (!topic) return topic
  if (topic.endsWith('y') && topic.length > 1 && !/[aeiou]y$/i.test(topic)) {
    return `${topic.slice(0, -1)}ies`
  }
  if (/(s|x|z|ch|sh)$/i.test(topic)) {
    return `${topic}es`
  }
  return `${topic}s`
}

function canonicalizeRawTopicTagValue(topic: string): string {
  return topic.trim().replace(/^#+/u, '').replace(/\s+/g, '-')
}

/**
 * One subrequest for all interests: NIP-01 treats multiple `#t` values as OR (any topic matches).
 * Expand every topic to singular+plural so feeds match either spelling on relays.
 */
export function buildInterestsSubRequests(
  relayUrls: string[],
  rawTopics: string[],
  kindsList: number[] = DEFAULT_FEED_SHOW_KINDS
): TFeedSubRequest[] {
  if (!relayUrls.length || !rawTopics.length || !kindsList.length) return []
  const normalizedBaseTopics = Array.from(
    new Set(rawTopics.map((t) => normalizeTopic(t)).filter((t) => t.length > 0))
  ).slice(0, INTERESTS_MAX_TOPICS)
  const rawCasedTopics = Array.from(
    new Set(rawTopics.map((t) => canonicalizeRawTopicTagValue(t)).filter((t) => t.length > 0))
  ).slice(0, INTERESTS_MAX_TOPICS)
  if (!normalizedBaseTopics.length && !rawCasedTopics.length) return []
  const topics = Array.from(new Set([
    ...normalizedBaseTopics.flatMap((topic) => {
      const singular = normalizeTopic(topic)
      const plural = pluralizeTopic(singular)
      return [singular, plural]
    }),
    ...rawCasedTopics.flatMap((topic) => [topic, pluralizeTopic(topic)])
  ])).slice(0, INTERESTS_MAX_TOPIC_TAG_VALUES)
  if (!topics.length) return []
  return [
    {
      urls: relayUrls,
      filter: {
        kinds: kindsList,
        '#t': topics,
        limit: FAUX_SPELL_EVENT_LIMIT
      }
    }
  ]
}

/** Bookmark list e-tags only (hex ids); addressable (a-tag) bookmarks need separate fetches. */
export function buildBookmarksSubRequests(bookmarkListEvent: Event | null, urls: string[]): TFeedSubRequest[] {
  if (!bookmarkListEvent?.tags?.length || !urls.length) return []
  const ids = bookmarkListEvent.tags
    .filter((t) => t[0] === 'e' && t[1] && /^[a-f0-9]{64}$/i.test(t[1]))
    .map((t) => t[1] as string)
  if (!ids.length) return []
  const cap = FAUX_SPELL_EVENT_LIMIT
  const slice = ids.slice(0, cap)
  return [{ urls, filter: { ids: slice, limit: slice.length } }]
}

/** NIP-B0 web bookmarks (kind 39701) authored by the user — merged with NIP-51 id bookmarks in the Bookmarks spell. */
export function buildWebBookmarksSpellSubRequests(pubkey: string, urls: string[]): TFeedSubRequest[] {
  if (!pubkey || !urls.length) return []
  const pk = /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
  return [
    {
      urls,
      filter: {
        authors: [pk],
        kinds: [ExtendedKind.WEB_BOOKMARK],
        limit: FAUX_SPELL_EVENT_LIMIT
      }
    }
  ]
}
