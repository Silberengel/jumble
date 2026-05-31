import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { NIP_SEARCH_DOCUMENT_KINDS } from '@/constants'
import { kindsForSingleRelayBrowse, relayUrlIsDocumentRelay } from './single-relay-browse-kinds'

describe('single-relay-browse-kinds', () => {
  it('detects document relays', () => {
    expect(relayUrlIsDocumentRelay('wss://essayist.decentnewsroom.com/')).toBe(true)
    expect(relayUrlIsDocumentRelay('wss://relay.damus.io/')).toBe(false)
  })

  it('merges document kinds for document relays', () => {
    const out = kindsForSingleRelayBrowse('wss://essayist.decentnewsroom.com/', [kinds.ShortTextNote])
    expect(out).toContain(kinds.ShortTextNote)
    for (const k of NIP_SEARCH_DOCUMENT_KINDS) {
      expect(out).toContain(k)
    }
  })

  it('keeps picker kinds only for generic relays', () => {
    expect(kindsForSingleRelayBrowse('wss://relay.damus.io/', [kinds.ShortTextNote])).toEqual([
      kinds.ShortTextNote
    ])
  })
})
