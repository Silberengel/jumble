import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import {
  articleUrlMatchesThreadScope,
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl,
  getReactionPageUrlFromRTags,
  getWebBookmarkArticleUrl,
} from '@/lib/rss-article'
import { expandWebBookmarkDTagQueryValues } from '@/lib/web-bookmark-nip'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import indexedDb from '@/services/indexed-db.service'
import { kinds, type Event, type Filter } from 'nostr-tools'

/** Dispatched after publishing a kind 17 web URL reaction so URL-thread UIs can refetch. */
export const WEB_EXTERNAL_REACTION_PUBLISHED_EVENT = 'jumble:webExternalReactionPublished'

/** IndexedDB: JSON array of canonical article URLs promoted for full Nostr thread UI. */
const RSS_WEB_PROMOTED_THREAD_URLS_SETTING = 'rssWebPromotedThreadUrls'

const MAX_PROMOTED_THREAD_URLS = 300

export async function loadPromotedRssThreadUrls(): Promise<string[]> {
  const raw = await indexedDb.getSetting(RSS_WEB_PROMOTED_THREAD_URLS_SETTING)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const x of parsed) {
      if (typeof x !== 'string') continue
      const c = canonicalizeRssArticleUrl(x.trim())
      if (isHttpArticleUrl(c)) out.push(c)
    }
    return [...new Set(out)].slice(0, MAX_PROMOTED_THREAD_URLS)
  } catch {
    return []
  }
}

export async function addPromotedRssThreadUrl(rawUrl: string): Promise<string> {
  const canonical = canonicalizeRssArticleUrl(rawUrl.trim())
  if (!isHttpArticleUrl(canonical)) return canonical
  const existing = await loadPromotedRssThreadUrls()
  const filtered = existing.filter((u) => u !== canonical)
  const next = [canonical, ...filtered].slice(0, MAX_PROMOTED_THREAD_URLS)
  await indexedDb.setSetting(RSS_WEB_PROMOTED_THREAD_URLS_SETTING, JSON.stringify(next))
  return canonical
}

/** Marks a URL for full Nostr thread UI and notifies listeners. */
export async function promoteRssArticleForNostrThread(rawUrl: string): Promise<string> {
  const canonical = await addPromotedRssThreadUrl(rawUrl)
  if (!isHttpArticleUrl(canonical)) return canonical
  window.dispatchEvent(new CustomEvent(WEB_EXTERNAL_REACTION_PUBLISHED_EVENT))
  return canonical
}

export function isHttpArticleUrl(url: string): boolean {
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

/** Kinds shown under “Antworten” on article URL threads. */
export const RSS_URL_THREAD_ANTWORTEN_KINDS: readonly number[] = [
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE_COMMENT,
  kinds.Highlights,
  ExtendedKind.WEB_BOOKMARK,
  kinds.Reaction
]

const RSS_URL_THREAD_ANTWORTEN_KIND_SET = new Set(RSS_URL_THREAD_ANTWORTEN_KINDS)

/** Highlights, web bookmarks, and page-targeted reactions — backlinks tail on URL threads. */
export function isRssUrlThreadAntwortenTailKind(kind: number): boolean {
  return kind === kinds.Highlights || kind === ExtendedKind.WEB_BOOKMARK || kind === kinds.Reaction
}

export function buildRssArticleUrlThreadInteractionFilterGroups(
  canonicalArticleUrl: string,
  limit: number
): { nonSocial: Filter[]; social: Filter[] } {
  const canonical = canonicalizeRssArticleUrl(canonicalArticleUrl)
  const tagVals = expandArticleUrlThreadQueryValues(canonical)
  const iFilterVals = tagVals.length > 0 ? tagVals : [canonical]
  const dFilterVals = expandWebBookmarkDTagQueryValues(canonical)
  const rFilterVals = tagVals.length > 0 ? tagVals : [canonical]
  const social: Filter[] = [
    { '#i': iFilterVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit },
    { '#I': iFilterVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit }
  ]
  const nonSocial: Filter[] = [
    { '#r': rFilterVals, kinds: [kinds.Highlights], limit },
    { '#r': rFilterVals, kinds: [kinds.Reaction], limit }
  ]
  if (dFilterVals.length > 0) {
    nonSocial.push({ '#d': dFilterVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit })
  }
  nonSocial.push(
    { '#i': iFilterVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit },
    { '#I': iFilterVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit }
  )
  return { nonSocial, social }
}

/** REQ filters for Nostr comments, reactions, and highlights on one article URL (synthetic thread). */
export function buildRssArticleUrlThreadInteractionFilters(
  canonicalArticleUrl: string,
  limit: number
): Filter[] {
  const { nonSocial, social } = buildRssArticleUrlThreadInteractionFilterGroups(
    canonicalArticleUrl,
    limit
  )
  return [...nonSocial, ...social]
}

/** Whether `evt` belongs to the URL-scoped article thread responses (kinds 1111, 9802, 39701, 7). */
export function isRssArticleUrlThreadInteraction(evt: Event, canonicalArticleUrl: string): boolean {
  if (!RSS_URL_THREAD_ANTWORTEN_KIND_SET.has(evt.kind)) return false
  const key = canonicalizeRssArticleUrl(canonicalArticleUrl)
  if (evt.kind === kinds.Highlights) {
    const hu = getHighlightSourceHttpUrl(evt)
    return !!hu && articleUrlMatchesThreadScope(hu, key)
  }
  if (evt.kind === ExtendedKind.WEB_BOOKMARK) {
    const u = getWebBookmarkArticleUrl(evt)
    return !!u && articleUrlMatchesThreadScope(u, key)
  }
  if (evt.kind === kinds.Reaction) {
    const u = getReactionPageUrlFromRTags(evt)
    return !!u && articleUrlMatchesThreadScope(u, key)
  }
  if (evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
    const u = getArticleUrlFromCommentITags(evt)
    return !!u && articleUrlMatchesThreadScope(u, key)
  }
  return false
}

/** Inbox + favorites + fast read: one normalized list for article URL thread relay queries. */
export async function buildRssWebNostrQueryRelayUrls(options: {
  accountPubkey: string | null
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { accountPubkey, favoriteRelays, blockedRelays } = options
  const inboxAndFavorites: string[] = accountPubkey
    ? await buildAccountListRelayUrlsForMerge({
        accountPubkey,
        favoriteRelays,
        blockedRelays
      })
    : getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
  return dedupeNormalizeRelayUrlsOrdered([...inboxAndFavorites, ...FAST_READ_RELAY_URLS])
}
