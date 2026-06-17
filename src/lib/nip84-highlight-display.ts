import { getHighlightSourceHttpUrl } from '@/lib/rss-article'
import type { Event } from 'nostr-tools'

/**
 * NIP-84 / Web Annotation style `textquoteselector` (prefix + exact + suffix).
 * `exact` is always {@link Event.content} in classic NIP-84; some web clients store
 * commentary in `content` and anchor via selectors + `r` (http source) instead.
 *
 * Common shapes:
 * - `["textquoteselector", prefix, suffix]` (3 items)
 * - `["textquoteselector", "-", prefix, suffix]` — leading "-" = empty slot (Hypothesis-style)
 */
export function parseTextQuoteSelectorParts(tag: readonly string[]): { prefix: string; suffix: string } {
  if (tag.length < 2 || tag[0] !== 'textquoteselector') {
    return { prefix: '', suffix: '' }
  }
  if (tag.length >= 4 && tag[1] === '-') {
    return {
      prefix: (tag[2] ?? '').trim(),
      suffix: (tag[3] ?? '').trim()
    }
  }
  if (tag.length >= 3) {
    return {
      prefix: (tag[1] ?? '').trim(),
      suffix: (tag[2] ?? '').trim()
    }
  }
  return { prefix: '', suffix: '' }
}

/** `["textpositionselector", start, end]` — character offsets into a full document string. */
function parseTextPositionSelector(tag: readonly string[]): { start: number; end: number } | null {
  if (tag.length < 3 || tag[0] !== 'textpositionselector') return null
  const start = parseInt(tag[1] ?? '', 10)
  const end = parseInt(tag[2] ?? '', 10)
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end <= start) return null
  return { start, end }
}

export type Nip84HighlightDisplayMode = 'quote' | 'web-annotation'

export type Nip84HighlightDisplay = {
  mode: Nip84HighlightDisplayMode
  /** Full passage to show in the quote box */
  fullText: string
  /** Substring of fullText to wrap in <mark> */
  markedSpan: string
  /** Prefix/suffix fragments from the source page when selectors do not wrap {@link Event.content}. */
  sourceAnchorHint?: string
}

export function formatNip84SourceAnchorHint(prefix: string, suffix: string): string | undefined {
  const p = prefix.trim()
  const s = suffix.trim()
  if (p && s) return `${p} … ${s}`
  return p || s || undefined
}

/** True when prefix/suffix look like page anchors, not adjacent text around `content`. */
export function textQuoteSelectorMisalignsWithContent(
  content: string,
  prefix: string,
  suffix: string
): boolean {
  const exact = content.trim()
  if (!prefix && !suffix) return false
  if (prefix && exact.includes(prefix)) return false
  if (suffix && exact.includes(suffix)) return false

  const prefixTail = prefix.slice(-24).trim().toLowerCase()
  const suffixHead = suffix.slice(0, 24).trim().toLowerCase()
  const exactLower = exact.toLowerCase()
  if (prefixTail.length >= 8 && exactLower.startsWith(prefixTail)) return false
  if (suffixHead.length >= 8 && exactLower.endsWith(suffixHead)) return false

  return prefix.length > 0 && suffix.length > 0
}

function hasDomAnnotationSelectors(tags: readonly string[][]): boolean {
  return tags.some((t) => t[0] === 'rangeselector' || t[0] === 'textpositionselector')
}

function looksLikeWebPageAnnotation(
  tags: readonly string[][],
  content: string,
  prefix: string,
  suffix: string,
  contextBody: string | undefined
): boolean {
  if (contextBody) return false
  const httpSource = !!getHighlightSourceHttpUrl({ tags })
  if (!httpSource && !hasDomAnnotationSelectors(tags)) return false
  return textQuoteSelectorMisalignsWithContent(content, prefix, suffix)
}

/**
 * Resolve which span to mark inside which full text, using `context`, `textquoteselector`,
 * and optionally `textpositionselector` (only when offsets fit the base string).
 */
export function resolveNip84HighlightDisplay(event: Pick<Event, 'content' | 'tags'>): Nip84HighlightDisplay {
  const highlightedText = event.content ?? ''
  const tags = event.tags

  const contextTag = tags.find((t) => t[0] === 'context')
  const contextBody = contextTag?.[1]?.trim() ? contextTag[1] : undefined

  const posTag = tags.find((t) => t[0] === 'textpositionselector')
  const pos = posTag ? parseTextPositionSelector(posTag) : null

  if (contextBody && pos) {
    const { start, end } = pos
    if (end <= contextBody.length) {
      const slice = contextBody.slice(start, end)
      if (slice.length > 0) {
        return { mode: 'quote', fullText: contextBody, markedSpan: slice }
      }
    }
  }

  if (contextBody) {
    return { mode: 'quote', fullText: contextBody, markedSpan: highlightedText }
  }

  const tqs = tags.find((t) => t[0] === 'textquoteselector')
  if (tqs) {
    const { prefix, suffix } = parseTextQuoteSelectorParts(tqs)
    if (looksLikeWebPageAnnotation(tags, highlightedText, prefix, suffix, contextBody)) {
      return {
        mode: 'web-annotation',
        fullText: highlightedText,
        markedSpan: highlightedText,
        sourceAnchorHint: formatNip84SourceAnchorHint(prefix, suffix)
      }
    }
    const fullText = `${prefix}${highlightedText}${suffix}`
    return { mode: 'quote', fullText, markedSpan: highlightedText }
  }

  return { mode: 'quote', fullText: highlightedText, markedSpan: highlightedText }
}
