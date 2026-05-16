import { describe, expect, it } from 'vitest'
import { buildReplyReadRelayList } from '@/lib/relay-list-builder'

describe('buildReplyReadRelayList relayAuthoritative', () => {
  it('returns only thread hints and author/user layers without favorite bootstrap', async () => {
    const out = await buildReplyReadRelayList(
      undefined,
      undefined,
      [],
      ['wss://nostr.land/'],
      { relayAuthoritative: true }
    )
    expect(out).toEqual(['wss://nostr.land/'])
  })
})
