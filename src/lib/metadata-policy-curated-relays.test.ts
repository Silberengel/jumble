import { PROFILE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import { isMetadataPolicyCuratedRelay } from './metadata-policy-curated-relays'

describe('metadata-policy-curated-relays', () => {
  it('recognizes profile relay constants', () => {
    expect(isMetadataPolicyCuratedRelay(PROFILE_RELAY_URLS[0]!)).toBe(true)
    expect(isMetadataPolicyCuratedRelay('wss://nostr.wirednet.jp/')).toBe(false)
  })
})
