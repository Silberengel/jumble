import { stripMarkdownLinksForBlurb } from '@/lib/image-url-identity'
import { findHttpUrlsInText } from '@/lib/url'

/** Max length for card blurb when the `summary` tag is absent (article-style events). */
export const CARD_EVENT_BODY_BLURB_MAX = 250

/**
 * First {@link CARD_EVENT_BODY_BLURB_MAX} characters of event `content`, stripped of common
 * markdown / lightweight HTML so feed cards can show a readable teaser without a `summary` tag.
 */
export function cardEventBodyBlurb(raw: string | undefined, max = CARD_EVENT_BODY_BLURB_MAX): string {
  if (raw == null) return ''
  let s = raw.trim()
  if (!s) return ''

  s = stripMarkdownLinksForBlurb(s)

  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`[^`]+`/g, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/^[-*+]\s+/gm, '')
  s = s.replace(/^\d+\.\s+/gm, '')
  s = s.replace(/\*\*|__/g, '')
  s = s.replace(/~~/g, '')
  s = s.replace(/\*|_/g, ' ')

  for (const { url } of findHttpUrlsInText(s)) {
    s = s.split(url).join(' ')
  }

  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, max).trimEnd()}…`
}
