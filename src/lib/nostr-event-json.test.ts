import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  findTrailingStringifiedNostrEvent,
  isNostrEventJson,
  stripTrailingStringifiedNostrEvent
} from './nostr-event-json'

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    kind: 1,
    tags: [['p', 'c'.repeat(64)]],
    content: 'original note',
    sig: 'd'.repeat(128),
    ...overrides
  }
}

describe('nostr event JSON helpers', () => {
  it('recognizes serialized nostr events', () => {
    expect(isNostrEventJson(event())).toBe(true)
    expect(isNostrEventJson({ ...event(), id: 'not-hex' })).toBe(false)
    expect(isNostrEventJson({ ...event(), tags: [['p', 1]] })).toBe(false)
  })

  it('extracts a whole stringified event', () => {
    const target = event()
    const match = findTrailingStringifiedNostrEvent(JSON.stringify(target))

    expect(match?.event.id).toBe(target.id)
    expect(match?.textBefore).toBe('')
  })

  it('extracts trailing event JSON after quote text', () => {
    const target = event({ content: 'quoted target' })
    const content = `This is my comment before the boost.\n\n${JSON.stringify(target)}`
    const match = findTrailingStringifiedNostrEvent(content)

    expect(match?.event.content).toBe('quoted target')
    expect(match?.textBefore).toBe('This is my comment before the boost.')
    expect(stripTrailingStringifiedNostrEvent(content)).toBe('This is my comment before the boost.')
  })

  it('leaves ordinary JSON alone', () => {
    const content = 'Here is config {"theme":"dark"}'

    expect(findTrailingStringifiedNostrEvent(content)).toBeNull()
    expect(stripTrailingStringifiedNostrEvent(content)).toBe(content)
  })
})
