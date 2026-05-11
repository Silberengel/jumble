import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'

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
})
