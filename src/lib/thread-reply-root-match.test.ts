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
})
