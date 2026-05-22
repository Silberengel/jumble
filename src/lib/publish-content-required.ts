import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

/** Kinds that must have non-whitespace `content` before Publish is enabled. */
export const PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS: ReadonlySet<number> = new Set([
  kinds.ShortTextNote, // 1 — notes and kind-1 replies
  ExtendedKind.COMMENT, // 1111
  ExtendedKind.PUBLIC_MESSAGE, // 24
  kinds.LongFormArticle, // 30023
  ExtendedKind.NOSTR_SPECIFICATION, // 30817
  ExtendedKind.WIKI_ARTICLE, // 30818
  ExtendedKind.PUBLICATION_CONTENT // 30041
])

export function publishRequiresNonemptyContent(kind: number): boolean {
  return PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(kind)
}

export function hasNonemptyPublishContent(content: string): boolean {
  return content.trim().length > 0
}

/** Whether Publish should be enabled for this kind and composer body. */
export function canPublishWithContent(kind: number, content: string): boolean {
  if (!publishRequiresNonemptyContent(kind)) return true
  return hasNonemptyPublishContent(content)
}
