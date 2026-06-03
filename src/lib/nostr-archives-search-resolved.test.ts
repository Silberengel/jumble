import { describe, expect, it } from 'vitest'
import { archivesSearchResolvedToParams } from './nostr-archives-search-resolved'
import { nip19 } from 'nostr-tools'

const TEST_HEX = '3bf0d63a9344db8bd60b9072ff3e50b9a6662a93f2a4b9a86dd19e4559c94512'

describe('archivesSearchResolvedToParams', () => {
  it('maps profile type + hex pubkey', () => {
    const params = archivesSearchResolvedToParams({ type: 'profile', pubkey: TEST_HEX })
    expect(params?.type).toBe('profile')
    expect(params?.search).toBe(nip19.npubEncode(TEST_HEX))
  })

  it('maps note type + hex id', () => {
    const params = archivesSearchResolvedToParams({ type: 'note', id: TEST_HEX })
    expect(params?.type).toBe('note')
    expect(params?.search).toBe(TEST_HEX)
  })

  it('maps bech32 string resolved payload', () => {
    const npub = nip19.npubEncode(TEST_HEX)
    const params = archivesSearchResolvedToParams(npub)
    expect(params?.type).toBe('profile')
    expect(params?.search).toBe(npub)
  })
})
