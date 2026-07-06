import { stripMarkdownLinksForBlurb } from '@/lib/image-url-identity'
import { findHttpUrlsInText } from '@/lib/url'

/** Max length for card blurb when the `summary` tag is absent (article-style events). */
export const CARD_EVENT_BODY_BLURB_MAX = 250

/** Which markup the event kind uses (e.g. 30023 → markdown, 30818/30041 → asciidoc). */
export type CardBlurbMarkup = 'markdown' | 'asciidoc'

/**
 * First {@link CARD_EVENT_BODY_BLURB_MAX} characters of event `content`, stripped of the
 * kind's markup (markdown or asciidoc) so feed cards show a readable plain-text teaser
 * without a `summary` tag.
 */
export function cardEventBodyBlurb(
  raw: string | undefined,
  opts: { max?: number; markup?: CardBlurbMarkup } = {}
): string {
  const max = opts.max ?? CARD_EVENT_BODY_BLURB_MAX
  const markup = opts.markup ?? 'markdown'
  if (raw == null) return ''
  let s = raw.trim()
  if (!s) return ''

  s = stripMarkdownLinksForBlurb(s)

  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`[^`]+`/g, ' ')
  s = s.replace(/<[^>]+>/g, ' ')

  if (markup === 'asciidoc') {
    // Block delimiters (----, ====, ****, ____, ++++, ...., ////) and |=== table fences.
    s = s.replace(/^(={4,}|-{4,}|\*{4,}|_{4,}|\+{4,}|\.{4,}|\/{4,}|\|={3,})\s*$/gm, ' ')
    // Attribute entries (:toc:, :imagesdir: …) and element attribute lines ([source,js], [NOTE]).
    s = s.replace(/^:[A-Za-z0-9_!-]+:.*$/gm, ' ')
    s = s.replace(/^\[[^\]\n]*\]\s*$/gm, ' ')
    // Line comments.
    s = s.replace(/^\/\/.*$/gm, ' ')
    // `= Heading` markers (keep heading text) and `.Block title` markers.
    s = s.replace(/^=+\s+/gm, '')
    s = s.replace(/^\.(?=\S)/gm, '')
    // Macros: image::path[alt] / link:url[text] / https://url[text] → keep alt/text.
    s = s.replace(/image::?[^[\s]*\[([^\]]*)\]/g, '$1')
    s = s.replace(/link:[^[\s]+\[([^\]]*)\]/g, '$1')
    s = s.replace(/https?:\/\/[^[\s]+\[([^\]]*)\]/g, '$1')
  } else {
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    s = s.replace(/^#{1,6}\s+/gm, '')
    s = s.replace(/^>\s?/gm, '')
  }

  // Setext-style heading underlines / horizontal rules (`====`, `----`, `~~~~`) in either markup.
  s = s.replace(/^\s{0,3}(=+|-+|~+|\^+|\*\s*\*[\s*]*)\s*$/gm, ' ')

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
