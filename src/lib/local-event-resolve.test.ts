import { describe, expect, it, vi, beforeEach } from 'vitest'
import { kinds, type Event } from 'nostr-tools'

const { peekSessionCachedEvent, getArchivedEventsByIds, findStoredReplaceableEventsByIds } = vi.hoisted(
  () => ({
    peekSessionCachedEvent: vi.fn(),
    getArchivedEventsByIds: vi.fn(async () => [] as Event[]),
    findStoredReplaceableEventsByIds: vi.fn(async () => [] as Event[]),
    getEventFromPublicationStore: vi.fn(async () => undefined as Event | undefined)
  })
)

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    getArchivedEventsByIds,
    getEventFromPublicationStore: vi.fn(async () => undefined),
    findStoredReplaceableEventsByIds
  }
}))

import { bindLocalEventResolveSessionPeek, resolveLocalEventsByHexIds } from './local-event-resolve'

function note(id: string): Event {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: kinds.ShortTextNote,
    tags: [],
    content: '',
    created_at: 100,
    sig: 'sig'
  }
}

describe('resolveLocalEventsByHexIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindLocalEventResolveSessionPeek(peekSessionCachedEvent)
  })

  it('returns session LRU hits first', async () => {
    const id = 'b'.repeat(64)
    const ev = note(id)
    peekSessionCachedEvent.mockReturnValue(ev)
    const out = await resolveLocalEventsByHexIds([id])
    expect(out).toEqual([ev])
    expect(getArchivedEventsByIds).not.toHaveBeenCalled()
  })

  it('falls back to replaceable list store when not in archive or session', async () => {
    const id = 'c'.repeat(64)
    const ev = note(id)
    ev.kind = kinds.BookmarkList
    peekSessionCachedEvent.mockReturnValue(undefined)
    getArchivedEventsByIds.mockResolvedValue([])
    findStoredReplaceableEventsByIds.mockResolvedValue([ev])
    const out = await resolveLocalEventsByHexIds([id])
    expect(out).toEqual([ev])
  })
})
