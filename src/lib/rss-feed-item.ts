import { canonicalizeRssArticleUrl } from '@/lib/rss-article'

/** Synthetic row for URL-only threads (Nostr activity on a link without RSS cache metadata). */
export const WEB_ONLY_FAUX_FEED_URL = 'nostr:jumble/web-faux-rss-item'

export interface RssFeedItemMedia {
  url: string
  type?: string
  credit?: string
  thumbnail?: string
  width?: string
  height?: string
}

export interface RssFeedItemEnclosure {
  url: string
  type: string
  length?: string
  duration?: string
}

export interface RssFeedItem {
  title: string
  link: string
  description: string
  pubDate: Date | null
  guid: string
  feedUrl: string
  feedTitle?: string
  feedImage?: string
  feedDescription?: string
  media?: RssFeedItemMedia[]
  enclosure?: RssFeedItemEnclosure
}

export function isWebOnlyFauxRssItem(item: Pick<RssFeedItem, 'feedUrl' | 'guid'>): boolean {
  return item.feedUrl === WEB_ONLY_FAUX_FEED_URL || item.guid.startsWith('web-only:')
}

export function createWebOnlyRssFeedItem(articleUrl: string): RssFeedItem {
  const canonical = canonicalizeRssArticleUrl(articleUrl.trim())
  return {
    title: canonical,
    link: canonical,
    description: '',
    pubDate: null,
    guid: `web-only:${canonical}`,
    feedUrl: WEB_ONLY_FAUX_FEED_URL,
    feedTitle: undefined
  }
}
