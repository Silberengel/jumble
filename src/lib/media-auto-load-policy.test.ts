import { describe, expect, it } from 'vitest'
import { MEDIA_AUTO_LOAD_POLICY } from '@/constants'
import { resolveAutoLoadMediaForAuthor } from '@/lib/media-auto-load-policy'
import type { Event } from 'nostr-tools'

const author = 'aa'.repeat(32)

function warnedNote(): Event {
  return {
    id: 'id',
    sig: 'sig',
    kind: 1,
    tags: [['content-warning', 'Sensitive content']],
    content: 'hello',
    created_at: 1,
    pubkey: author
  }
}

describe('resolveAutoLoadMediaForAuthor', () => {
  it('blocks autoload for content-warning notes even when author is followed', () => {
    expect(
      resolveAutoLoadMediaForAuthor({
        policy: MEDIA_AUTO_LOAD_POLICY.FOLLOWS_ONLY,
        authorPubkey: author,
        followings: [author],
        sourceEvent: warnedNote()
      })
    ).toBe(false)
  })

  it('allows autoload for followed authors on notes without content warnings', () => {
    expect(
      resolveAutoLoadMediaForAuthor({
        policy: MEDIA_AUTO_LOAD_POLICY.FOLLOWS_ONLY,
        authorPubkey: author,
        followings: [author],
        sourceEvent: { ...warnedNote(), tags: [] }
      })
    ).toBe(true)
  })

  it('blocks autoload for content warnings under ALWAYS policy', () => {
    expect(
      resolveAutoLoadMediaForAuthor({
        policy: MEDIA_AUTO_LOAD_POLICY.ALWAYS,
        authorPubkey: author,
        sourceEvent: warnedNote()
      })
    ).toBe(false)
  })
})
