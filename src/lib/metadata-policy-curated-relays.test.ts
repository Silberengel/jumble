import { DOCUMENT_RELAY_URLS, FAST_READ_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  isMetadataPolicyActiveReadGrantRelay,
  isMetadataPolicyCuratedRelay,
  isMetadataPolicyOperationScopedRelay
} from './metadata-policy-curated-relays'

describe('metadata-policy-curated-relays', () => {
  it('recognizes profile relay constants', () => {
    expect(isMetadataPolicyCuratedRelay(PROFILE_RELAY_URLS[0]!)).toBe(true)
    expect(isMetadataPolicyCuratedRelay('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('operation scope excludes FAST_READ widening', () => {
    expect(isMetadataPolicyOperationScopedRelay(DOCUMENT_RELAY_URLS[0]!)).toBe(true)
    expect(isMetadataPolicyOperationScopedRelay(PROFILE_RELAY_URLS[0]!)).toBe(true)
    expect(isMetadataPolicyOperationScopedRelay(FAST_READ_RELAY_URLS[0]!)).toBe(false)
    expect(isMetadataPolicyOperationScopedRelay('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('active read grant includes search and discovery stacks', () => {
    expect(isMetadataPolicyActiveReadGrantRelay('wss://search.nos.today/')).toBe(true)
    expect(isMetadataPolicyActiveReadGrantRelay(FAST_READ_RELAY_URLS[0]!)).toBe(false)
    expect(isMetadataPolicyActiveReadGrantRelay('wss://nostr.wirednet.jp/')).toBe(false)
  })
})
