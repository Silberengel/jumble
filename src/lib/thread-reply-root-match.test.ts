import { ExtendedKind } from '@/constants'
import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

const { peekSessionCachedEvent } = vi.hoisted(() => ({
  peekSessionCachedEvent: vi.fn()
}))

vi.mock('@/services/client.service', () => ({
  default: {
    peekSessionCachedEvent
  }
}))

import { eventReplyMatchesThreadRoot } from './thread-reply-root-match'

const rootId = '0'.repeat(64)
const parentId = '1'.repeat(64)
const childId = '2'.repeat(64)
const author = 'a'.repeat(64)

function event(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? 'f'.repeat(64),
    pubkey: overrides.pubkey ?? author,
    created_at: overrides.created_at ?? 1,
    kind: overrides.kind ?? 1,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
    sig: overrides.sig ?? 'b'.repeat(128)
  }
}

describe('eventReplyMatchesThreadRoot', () => {
  it('accepts a nested reply that only tags a cached parent in the thread', () => {
    const parent = event({
      id: parentId,
      tags: [
        ['e', rootId, '', 'root'],
        ['p', author]
      ]
    })
    const child = event({
      id: childId,
      tags: [
        ['e', parentId, '', 'reply'],
        ['p', author]
      ]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === parentId) return parent
      return undefined
    })

    expect(eventReplyMatchesThreadRoot(child, { type: 'E', id: rootId, pubkey: author })).toBe(true)
  })

  it('accepts a reply whose parent is a zap receipt on the thread root', () => {
    const zapId = '3'.repeat(64)
    const zapReceipt = event({
      id: zapId,
      kind: kinds.Zap,
      tags: [
        ['e', rootId],
        ['p', author]
      ]
    })
    const replyToZap = event({
      id: childId,
      tags: [
        ['e', zapId, '', 'reply'],
        ['p', author]
      ]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === zapId) return zapReceipt
      return undefined
    })

    expect(eventReplyMatchesThreadRoot(replyToZap, { type: 'E', id: rootId, pubkey: author })).toBe(true)
  })

  it('accepts a reply whose parent is a kind 9740 superchat on the thread root', () => {
    const superchatId = '4'.repeat(64)
    const superchat = event({
      id: superchatId,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [
        ['e', rootId],
        ['p', author],
        ['amount', '333000']
      ]
    })
    const replyToSuperchat = event({
      id: childId,
      tags: [
        ['e', superchatId, '', 'reply'],
        ['p', author]
      ]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === superchatId) return superchat
      return undefined
    })

    expect(eventReplyMatchesThreadRoot(replyToSuperchat, { type: 'E', id: rootId, pubkey: author })).toBe(
      true
    )
  })

  it('accepts kind 1 reply to replaceable article via parent a coordinate only', () => {
    const articleCoord = `30023:${author}:my-article`
    const reply = event({
      id: childId,
      kind: kinds.ShortTextNote,
      tags: [['a', articleCoord, '', 'reply'], ['p', author]]
    })

    expect(
      eventReplyMatchesThreadRoot(reply, {
        type: 'A',
        id: articleCoord,
        eventId: rootId,
        pubkey: author
      })
    ).toBe(true)
  })

  it('accepts kind 1 reply via lowercase root a tag on replaceable article', () => {
    const articleCoord = `30023:${author}:my-article`
    const reply = event({
      id: childId,
      kind: kinds.ShortTextNote,
      tags: [['a', articleCoord, '', 'root'], ['p', author]]
    })

    expect(
      eventReplyMatchesThreadRoot(reply, {
        type: 'A',
        id: articleCoord,
        eventId: rootId,
        pubkey: author
      })
    ).toBe(true)
  })

  it('accepts kind 1111 comment via uppercase A root tag', () => {
    const articleCoord = `30023:${author}:my-article`
    const reply = event({
      id: childId,
      kind: ExtendedKind.COMMENT,
      tags: [['A', articleCoord, '', 'root'], ['p', author]]
    })

    expect(
      eventReplyMatchesThreadRoot(reply, {
        type: 'A',
        id: articleCoord,
        eventId: rootId,
        pubkey: author
      })
    ).toBe(true)
  })

  it('accepts kind 1 reply to a kind 1111 comment on an E-root thread', () => {
    const comment1111 = event({
      id: parentId,
      kind: ExtendedKind.COMMENT,
      tags: [
        ['E', rootId, '', 'root'],
        ['e', rootId, '', 'reply'],
        ['p', author]
      ]
    })
    const kind1Reply = event({
      id: childId,
      kind: kinds.ShortTextNote,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', parentId, '', 'reply'],
        ['p', author]
      ]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === parentId) return comment1111
      return undefined
    })

    expect(eventReplyMatchesThreadRoot(kind1Reply, { type: 'E', id: rootId, pubkey: author })).toBe(true)
  })

  it('accepts kind 1111 reply to a kind 1 comment on an E-root thread', () => {
    const kind1Comment = event({
      id: parentId,
      kind: kinds.ShortTextNote,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply'],
        ['p', author]
      ]
    })
    const commentReply = event({
      id: childId,
      kind: ExtendedKind.COMMENT,
      tags: [
        ['E', rootId, '', 'root'],
        ['e', parentId, '', 'reply'],
        ['p', author]
      ]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === parentId) return kind1Comment
      return undefined
    })

    expect(eventReplyMatchesThreadRoot(commentReply, { type: 'E', id: rootId, pubkey: author })).toBe(true)
  })

  it('accepts kind 1 reply to kind 1111 when parent comment only declares article via a tag', () => {
    const articleCoord = `30023:${author}:my-article`
    const comment1111 = event({
      id: parentId,
      kind: ExtendedKind.COMMENT,
      tags: [
        ['a', articleCoord, '', 'root'],
        ['e', rootId, '', 'reply'],
        ['p', author]
      ]
    })
    const kind1Reply = event({
      id: childId,
      kind: kinds.ShortTextNote,
      tags: [['e', parentId, '', 'reply'], ['p', author]]
    })

    peekSessionCachedEvent.mockImplementation((id: string) => {
      if (id === parentId) return comment1111
      return undefined
    })

    expect(
      eventReplyMatchesThreadRoot(kind1Reply, {
        type: 'A',
        id: articleCoord,
        eventId: rootId,
        pubkey: author
      })
    ).toBe(true)
  })
})
