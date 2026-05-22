import { ExtendedKind } from '@/constants'
import {
  canPublishWithContent,
  publishRequiresNonemptyContent,
  PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS
} from '@/lib/publish-content-required'
import { kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

describe('publish-content-required', () => {
  it('includes the listed text-bearing kinds', () => {
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(kinds.ShortTextNote)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(ExtendedKind.COMMENT)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(ExtendedKind.PUBLIC_MESSAGE)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(kinds.LongFormArticle)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(ExtendedKind.NOSTR_SPECIFICATION)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(ExtendedKind.WIKI_ARTICLE)).toBe(true)
    expect(PUBLISH_REQUIRES_NONEMPTY_CONTENT_KINDS.has(ExtendedKind.PUBLICATION_CONTENT)).toBe(true)
  })

  it('rejects whitespace-only content for kind 1', () => {
    expect(publishRequiresNonemptyContent(1)).toBe(true)
    expect(canPublishWithContent(1, '   ')).toBe(false)
    expect(canPublishWithContent(1, 'hello')).toBe(true)
  })

  it('allows empty content for other kinds', () => {
    expect(canPublishWithContent(ExtendedKind.POLL, '')).toBe(true)
  })
})
