import { Event, kinds, nip19 } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import { getNoteBech32Id, isReplaceableEvent } from './event'
import { TSearchParams } from '@/types'

/** Same kinds as {@link useMenuActions} `isArticleType` for naddr + Alexandria publication URLs. */
const ALEXANDRIA_PUBLICATION_NADDR_KINDS = new Set<number>([
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN
])

/** NIP-19 `naddr` for article-like replaceable events (`d` tag required). */
export function encodeArticleLikePublicationNaddr(event: Event): string | null {
  if (!ALEXANDRIA_PUBLICATION_NADDR_KINDS.has(event.kind)) return null
  const d = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  try {
    const relays = event.tags
      .filter((tag) => tag[0] === 'relay')
      .map((tag) => tag[1])
      .filter(Boolean) as string[]
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: d,
      relays: relays.length > 0 ? relays : undefined
    })
  } catch {
    return null
  }
}

/** Full Alexandria reader URL for a publication `naddr` (matches NoteOptions “View on Alexandria”). */
export function getAlexandriaPublicationUrlFromNaddr(naddr: string): string {
  return `https://next-alexandria.gitcitadel.eu/publication/naddr/${naddr}`
}

export function openAlexandriaPublicationFromNaddr(naddr: string): void {
  const trimmed = naddr.trim()
  if (!trimmed) return
  window.open(getAlexandriaPublicationUrlFromNaddr(trimmed), '_blank', 'noopener,noreferrer')
}

/**
 * Note URL path segment. When `eventOrId` is a 64-char hex id and `hexResolutionEvent` is a loaded
 * replaceable/addressable event for that note, use its naddr/nevent so links stay canonical.
 */
export const toNote = (eventOrId: Event | string, hexResolutionEvent?: Event) => {
  if (typeof eventOrId === 'string') {
    if (
      hexResolutionEvent &&
      /^[0-9a-f]{64}$/i.test(eventOrId.trim()) &&
      isReplaceableEvent(hexResolutionEvent.kind)
    ) {
      return `/notes/${getNoteBech32Id(hexResolutionEvent)}`
    }
    return `/notes/${eventOrId}`
  }
  const nevent = getNoteBech32Id(eventOrId)
  return `/notes/${nevent}`
}
export const toNoteList = ({
  hashtag,
  search,
  externalContentId,
  domain,
  kinds
}: {
  hashtag?: string
  search?: string
  externalContentId?: string
  domain?: string
  kinds?: number[]
}) => {
  const path = '/notes'
  const query = new URLSearchParams()
  if (hashtag) query.set('t', hashtag.toLowerCase())
  if (kinds?.length) {
    kinds.forEach((k) => query.append('k', k.toString()))
  }
  if (search) query.set('s', search)
  if (externalContentId) query.set('i', externalContentId)
  if (domain) query.set('d', domain)
  return `${path}?${query.toString()}`
}
export const toProfile = (userId: string) => {
  if (userId.startsWith('npub') || userId.startsWith('nprofile')) return `/users/${userId}`
  const npub = nip19.npubEncode(userId)
  return `/users/${npub}`
}
export const toProfileList = ({ search, domain }: { search?: string; domain?: string }) => {
  const path = '/users'
  const query = new URLSearchParams()
  if (search) query.set('s', search)
  if (domain) query.set('d', domain)
  return `${path}?${query.toString()}`
}
export const toFollowingList = (pubkey: string) => {
  const npub = nip19.npubEncode(pubkey)
  return `/users/${npub}/following`
}
export const toOthersRelaySettings = (pubkey: string) => {
  const npub = nip19.npubEncode(pubkey)
  return `/users/${npub}/relays`
}
/** Cached note mentions / tags — session + IndexedDB archive scan (see profile interaction map page). */
export const toProfileInteractionMap = (pubkeyHex: string) => {
  const npub = nip19.npubEncode(pubkeyHex)
  return `/users/${npub}/interactions`
}
export const toSearch = (params?: TSearchParams) => {
  if (!params) return '/search'
  const query = new URLSearchParams()
  query.set('t', params.type)
  query.set('q', params.search)
  if (params.input) {
    query.set('i', params.input)
  }
  return `/search?${query.toString()}`
}
export const toRelaySettings = (tag?: 'mailbox' | 'favorite-relays') => {
  return '/settings/relays' + (tag ? '#' + tag : '')
}
export const toWallet = () => '/settings/wallet'
export const toPostSettings = () => '/settings/posts'
export const toGeneralSettings = () => '/settings/general'
export const toRssFeedSettings = () => '/settings/rss-feeds'
export const toFollowSetsSettings = () => '/settings/follow-sets'
export const toEmojiSetsSettings = () => '/settings/emoji-sets'
export const toCacheSettings = () => '/settings/cache'
export const toPersonalListsSettings = () => '/settings/personal-lists'
export const toProfileEditor = () => '/profile-editor'
export const toRelay = (url: string) => `/relays/${encodeURIComponent(url)}`
export const toRelayReviews = (url: string) => `/relays/${encodeURIComponent(url)}/reviews`
export const toMuteList = () => '/mutes'

export const toBookmarksList = () => '/bookmarks'

export const toPinsList = () => '/pins'
export const toInterestsList = () => '/interests'
export const toUserEmojiList = () => '/user-emojis'

export const toChachiChat = (relay: string, d: string) => {
  return `https://chachi.chat/${relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')}/${d}`
}
export const toAlexandria = (id: string) => `https://next-alexandria.gitcitadel.eu/events?id=${encodeURIComponent(id)}`
