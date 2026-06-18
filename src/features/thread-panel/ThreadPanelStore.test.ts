import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'
import {
  createThreadPanelStore,
  ingestThreadPanelEvents,
  replyIdInStore
} from './ThreadPanelStore'

function note(id: string): Event {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: kinds.ShortTextNote,
    tags: [['e', 'f'.repeat(64)]],
    content: 'hello',
    created_at: 100,
    sig: 'sig'
  }
}

describe('ThreadPanelStore ingest', () => {
  it('dedupes events across ingest calls', () => {
    const a = note('1'.repeat(64))
    const b = note('2'.repeat(64))
    let store = createThreadPanelStore()
    store = ingestThreadPanelEvents(store, [a, b], 'relay', { updateStats: false })
    store = ingestThreadPanelEvents(store, [a], 'session', { updateStats: false })
    expect(store.byId.size).toBe(2)
    expect(replyIdInStore(store, a.id)).toBe(true)
    expect(replyIdInStore(store, b.id)).toBe(true)
  })

  it('merges relay and idb sources into the tag index', () => {
    const root = 'f'.repeat(64)
    const reply = note('2'.repeat(64))
    reply.tags = [['e', root]]
    let store = createThreadPanelStore()
    store = ingestThreadPanelEvents(store, [reply], 'idb', { updateStats: false })
    const bucket = store.index.get(root)
    expect(bucket?.events.length).toBe(1)
    store = ingestThreadPanelEvents(store, [reply], 'relay', { updateStats: false })
    expect(store.index.get(root)?.events.length).toBe(1)
  })
})
