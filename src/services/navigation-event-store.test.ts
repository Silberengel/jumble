import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { candidateKeysForNoteUrlId, navigationEventStore } from './navigation-event-store'

describe('navigationEventStore', () => {
  it('aliases hex and nevent url ids', () => {
    const id = 'c89a8525b4ef8fd3dd149824e6d4f854de8b3120d26286942fd2aabce2d72304'
    const nevent = nip19.neventEncode({ id })
    const event = {
      id,
      kind: 1,
      pubkey: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      created_at: 1,
      tags: [],
      content: 'hello',
      sig: 'x'.repeat(128)
    }
    navigationEventStore.clear()
    navigationEventStore.setEvent(event as import('nostr-tools').Event, nevent)
    expect(navigationEventStore.peekEvent(nevent)?.id).toBe(id)
    expect(navigationEventStore.peekEvent(id)?.content).toBe('hello')
    navigationEventStore.clear()
  })

  it('decodes nevent keys for lookup', () => {
    const id = '88687efb89dc05a72a2505f61aa4f87579e87b43aa632b911dae2cdf916b621e'
    const nevent = nip19.neventEncode({ id })
    const keys = candidateKeysForNoteUrlId(nevent)
    expect(keys).toContain(nevent)
    expect(keys.map((k) => k.toLowerCase())).toContain(id)
  })
})
