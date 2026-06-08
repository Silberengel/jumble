import {
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  normalizeHttpArticleUrl
} from '@/lib/rss-article'

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
