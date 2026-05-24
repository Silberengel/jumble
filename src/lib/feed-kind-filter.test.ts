import { ExtendedKind } from '@/constants'
import {
  applyFeedGitGroupToggle,
  applyFeedPostsGroupToggle,
  applyFeedRepliesGroupToggle,
  eventPassesNoteListKindPicker,
  FEED_GIT_GROUP_KINDS,
  FEED_REPLIES_GROUP_KINDS,
  isFeedGitGroupEnabled,
  isFeedPostsGroupEnabled,
  isFeedRepliesGroupEnabled
} from '@/lib/feed-kind-filter'
import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: '0'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    content: '',
    sig: 'sig',
    ...partial
  }
}

describe('feed kind groups', () => {
  it('posts group toggles kind 1 OPs, highlights, discussions, photos, and voice posts together', () => {
    const off = applyFeedPostsGroupToggle([], false)
    expect(off.showKind1OPs).toBe(false)
    expect(isFeedPostsGroupEnabled(off.showKind1OPs, off.showKinds)).toBe(false)

    const on = applyFeedPostsGroupToggle(off.showKinds, true)
    expect(on.showKind1OPs).toBe(true)
    expect(on.showKinds).toContain(kinds.Highlights)
    expect(on.showKinds).toContain(ExtendedKind.DISCUSSION)
    expect(on.showKinds).toContain(ExtendedKind.PICTURE)
    expect(on.showKinds).toContain(ExtendedKind.VOICE)
    expect(isFeedPostsGroupEnabled(on.showKind1OPs, on.showKinds)).toBe(true)
  })

  it('git group toggles all git kinds together', () => {
    const off = applyFeedGitGroupToggle([], false)
    expect(isFeedGitGroupEnabled(off)).toBe(false)

    const on = applyFeedGitGroupToggle(off, true)
    for (const k of FEED_GIT_GROUP_KINDS) {
      expect(on).toContain(k)
    }
    expect(isFeedGitGroupEnabled(on)).toBe(true)
  })

  it('replies group toggles kind 1 replies, comments, voice comments, and superchat kinds together', () => {
    const off = applyFeedRepliesGroupToggle([], false)
    expect(off.showKind1Replies).toBe(false)
    expect(off.showKind1111).toBe(false)
    expect(isFeedRepliesGroupEnabled(off.showKind1Replies, off.showKind1111, off.showKinds)).toBe(
      false
    )

    const on = applyFeedRepliesGroupToggle(off.showKinds, true)
    expect(on.showKind1Replies).toBe(true)
    expect(on.showKind1111).toBe(true)
    expect(on.showKinds).toContain(ExtendedKind.VOICE_COMMENT)
    for (const k of FEED_REPLIES_GROUP_KINDS) {
      expect(on.showKinds).toContain(k)
    }
    expect(
      isFeedRepliesGroupEnabled(on.showKind1Replies, on.showKind1111, on.showKinds)
    ).toBe(true)
  })

  it('hides payment notifications when replies group flags are off', () => {
    const payment = fakeEvent({
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [['p', 'a'.repeat(64)], ['amount', '21000']]
    })
    const showKinds = [...FEED_REPLIES_GROUP_KINDS]
    expect(eventPassesNoteListKindPicker(payment, showKinds, true, false, false)).toBe(false)
    expect(eventPassesNoteListKindPicker(payment, showKinds, true, true, true)).toBe(true)
    expect(
      eventPassesNoteListKindPicker(
        fakeEvent({ id: 'z'.repeat(64), kind: ExtendedKind.ZAP_RECEIPT, tags: [] }),
        showKinds,
        true,
        true,
        true
      )
    ).toBe(true)
  })
})
