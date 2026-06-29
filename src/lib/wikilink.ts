/**
 * Wiki-style links (`[[Term]]` or `[[target|display]]`) shared between the long-form article
 * renderers and the generic note/comment content pipeline.
 */
import { normalizeWikiDTag } from '@/lib/nip54'

/** Inline `[[...]]` matcher (global). Brackets are excluded from the inner group to avoid nesting. */
export const WIKILINK_INLINE_REGEX = /\[\[([^[\]]+)\]\]/g

/**
 * Slugify a wikilink target into the `d` tag used for d-tag browse (e.g. "April" → "april").
 * Uses the NIP-54 normalization rules (preserves non-ASCII letters/numbers).
 */
export function wikilinkTargetToDTag(target: string): string {
  return normalizeWikiDTag(target)
}

/**
 * Parse the inner content of a wikilink (without the surrounding brackets) into the d-tag to
 * browse and the text to display. Supports the `target|display` alias form.
 */
export function parseWikilinkInner(inner: string): { dTag: string; displayText: string } {
  const linkContent = inner.trim()
  const hasAlias = linkContent.includes('|')
  const target = hasAlias ? linkContent.split('|')[0].trim() : linkContent
  const displayText = hasAlias ? linkContent.split('|').slice(1).join('|').trim() : linkContent
  return { dTag: wikilinkTargetToDTag(target), displayText: displayText || linkContent }
}

/** Citations reuse the `[[...]]` syntax (`[[citation::...]]`) and must not be treated as wikilinks. */
export function isCitationWikilink(inner: string): boolean {
  return inner.trim().startsWith('citation::')
}
