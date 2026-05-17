import { describe, expect, it } from 'vitest'
import { kinds, finalizeEvent, generateSecretKey } from 'nostr-tools'
import { parseJsonlCacheImportText, parsePastedCacheImportJson } from './cache-event-import'

function signedNote(content: string) {
  const sk = generateSecretKey()
  return finalizeEvent(
    {
      kind: kinds.ShortTextNote,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content
    },
    sk
  )
}

describe('parsePastedCacheImportJson', () => {
  it('accepts a single signed event object', () => {
    const ev = signedNote('hello')
    const { events, issues } = parsePastedCacheImportJson(JSON.stringify(ev))
    expect(issues).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe(ev.id)
  })

  it('rejects invalid JSON', () => {
    const { events, issues } = parsePastedCacheImportJson('{not json')
    expect(events).toHaveLength(0)
    expect(issues[0].message).toMatch(/Invalid JSON/i)
  })
})

describe('parseJsonlCacheImportText', () => {
  it('parses one event per line', () => {
    const a = signedNote('a')
    const b = signedNote('b')
    const text = `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`
    const { events, issues } = parseJsonlCacheImportText(text)
    expect(issues).toHaveLength(0)
    expect(events).toHaveLength(2)
  })
})
