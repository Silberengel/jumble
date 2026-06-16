import { ExtendedKind } from '@/constants'
import { generateBech32IdFromATag } from '@/lib/tag'
import {
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  normalizeHttpArticleUrl
} from '@/lib/rss-article'
import { nip19, type Event } from 'nostr-tools'

const REPLACEABLE_COORDINATE_RE = /^(\d+):([0-9a-f]{64}):(.*)$/i

/** NIP-33 coordinate in an `a` or `d` tag: `<kind>:<hex pubkey>:<d identifier>`. */
export function parseReplaceableCoordinateTag(value: string): {
  kind: number
  pubkey: string
  identifier: string
} | null {
  const m = REPLACEABLE_COORDINATE_RE.exec(value.trim())
  if (!m) return null
  const kind = Number(m[1])
  if (!Number.isFinite(kind)) return null
  return { kind, pubkey: m[2]!.toLowerCase(), identifier: m[3]! }
}

/**
 * kind 39701 bookmark targeting a Nostr replaceable event (`a` tag or coordinate `d` tag)
 * instead of an http(s) page. Returns naddr bech32 for {@link EmbeddedNote}.
 */
export function getWebBookmarkReplaceableEventNaddr(
  event: Pick<Event, 'kind' | 'tags'>
): string | undefined {
  if (event.kind !== ExtendedKind.WEB_BOOKMARK) return undefined

  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]?.trim()) continue
    const naddr = generateBech32IdFromATag(tag)
    if (naddr) return naddr
  }

  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (!dTag) return undefined
  const coord = parseReplaceableCoordinateTag(dTag)
  if (!coord) return undefined
  try {
    return nip19.naddrEncode({
      kind: coord.kind,
      pubkey: coord.pubkey,
      identifier: coord.identifier
    })
  } catch {
    return undefined
  }
}

/**
 * NIP-B0: `d` tag is the URL without the scheme (`https://` / `http://` assumed).
 */
export function urlToWebBookmarkDTag(url: string): string {
  const t = url.trim()
  if (!t) return ''
  const withScheme =
    t.startsWith('http://') || t.startsWith('https://') ? canonicalizeRssArticleUrl(t) : `https://${t}`
  return withScheme.replace(/^https?:\/\//i, '')
}

/** Parse NIP-B0 `d` tag (scheme-less URL) back to a canonical http(s) URL. */
export function webBookmarkDTagToUrl(dTag: string): string | null {
  return normalizeHttpArticleUrl(dTag.trim())
}

/** `d`-tag values for REQ `#d` filters when resolving bookmarks for one article URL. */
export function expandWebBookmarkDTagQueryValues(canonicalUrl: string): string[] {
  const out = new Set<string>()
  for (const u of expandArticleUrlThreadQueryValues(canonicalUrl)) {
    const d = urlToWebBookmarkDTag(u)
    if (d) out.add(d)
  }
  const direct = urlToWebBookmarkDTag(canonicalUrl)
  if (direct) out.add(direct)
  return [...out]
}
