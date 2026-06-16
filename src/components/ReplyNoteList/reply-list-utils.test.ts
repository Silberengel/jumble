import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import type { TRepliesMap } from '@/lib/reply-index'
import {
  classifyUnresolvedStatsReplyMissingPlacement,
  insertMissingStatsReplyPlaceholders,
  partitionStatsRepliesForMissingPlaceholders
} from './reply-list-utils'
import type { TRootInfo } from './types'

function note(id: string, created_at: number, kind = kinds.ShortTextNote, tags: string[][] = []): Event {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind,
    tags,
    content: '',
    created_at,
    sig: 'sig'
  }
}

function repliesBucket(events: Event[]) {
  return { events, eventIdSet: new Set(events.map((e) => e.id)) }
}

const eRoot: TRootInfo = { type: 'E', id: 'f'.repeat(64), pubkey: 'p'.repeat(64) }

describe('classifyUnresolvedStatsReplyMissingPlacement', () => {
  it('places bookmark/list op-reference kinds in tail when peeked', () => {
    const id = 'b'.repeat(64)
    const bookmark = note(id, 100, kinds.BookmarkList)
    const repliesMap: TRepliesMap = new Map([[eRoot.id, repliesBucket([bookmark])]])
    const placement = classifyUnresolvedStatsReplyMissingPlacement(
      { id, pubkey: bookmark.pubkey },
      eRoot,
      repliesMap
    )
    expect(placement).toBe('tail')
  })

  it('places unknown ids on E/A roots in tail (bookmarks/lists default)', () => {
    const id = 'c'.repeat(64)
    const placement = classifyUnresolvedStatsReplyMissingPlacement(
      { id, pubkey: 'd'.repeat(64) },
      eRoot,
      new Map()
    )
    expect(placement).toBe('tail')
  })

  it('places bookmark author pubkeys in tail when event is not peeked', () => {
    const id = 'e'.repeat(64)
    const pubkey = 'd'.repeat(64)
    const placement = classifyUnresolvedStatsReplyMissingPlacement(
      { id, pubkey },
      eRoot,
      new Map(),
      { bookmarkAuthorPubkeys: new Set([pubkey]) }
    )
    expect(placement).toBe('tail')
  })

  it('keeps kind-1 replies in the reply middle', () => {
    const id = '1'.repeat(64)
    const reply = note(id, 100, kinds.ShortTextNote, [['e', eRoot.id]])
    const repliesMap: TRepliesMap = new Map([[eRoot.id, repliesBucket([reply])]])
    const placement = classifyUnresolvedStatsReplyMissingPlacement(
      { id, pubkey: reply.pubkey },
      eRoot,
      repliesMap
    )
    expect(placement).toBe('reply-middle')
  })
})

describe('partitionStatsRepliesForMissingPlaceholders', () => {
  it('splits unresolved stats into reply thread vs tail', () => {
    const replyId = 'a'.repeat(64)
    const bookmarkId = 'b'.repeat(64)
    const resolvedIds = new Set<string>()
    const stats = [
      { id: replyId, pubkey: '1'.repeat(64), created_at: 100 },
      { id: bookmarkId, pubkey: '2'.repeat(64), created_at: 200 }
    ]
    const bookmark = note(bookmarkId, 200, kinds.BookmarkList)
    const repliesMap: TRepliesMap = new Map([
      [eRoot.id, repliesBucket([bookmark, note(replyId, 100, ExtendedKind.COMMENT)])]
    ])
    const { replyThread, tail } = partitionStatsRepliesForMissingPlaceholders(
      stats,
      resolvedIds,
      eRoot,
      repliesMap
    )
    expect(replyThread.map((r) => r.id)).toEqual([replyId])
    expect(tail.map((r) => r.id)).toEqual([bookmarkId])
  })
})

describe('insertMissingStatsReplyPlaceholders', () => {
  it('inserts missing stats ids as placeholder rows', () => {
    const resolved = [note('b'.repeat(64), 200)]
    const stats = [
      { id: 'c'.repeat(64), pubkey: 'd'.repeat(64), created_at: 100 },
      { id: 'b'.repeat(64), pubkey: 'a'.repeat(64), created_at: 200 }
    ]
    const out = insertMissingStatsReplyPlaceholders(resolved, stats, 'oldest')
    expect(out).toHaveLength(2)
    expect(out[0]?.type).toBe('missing')
    expect(out[1]?.type).toBe('event')
  })

  it('skips placeholders for resolved ids', () => {
    const id = 'e'.repeat(64)
    const resolved = [note(id, 100)]
    const stats = [{ id, pubkey: 'a'.repeat(64), created_at: 100 }]
    const out = insertMissingStatsReplyPlaceholders(resolved, stats, 'oldest')
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('event')
  })
})
