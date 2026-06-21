import { describe, expect, it } from 'vitest'
import nostrArchivesApi, { isArchivesApiCircuitFailure } from '@/services/nostr-archives-api.service'

const EVENT_ID = '3047103e518909910b1fc10ca1f4cb0122e6e28f497fa2ad1f41e6e7e7adf3cf'

describe('isArchivesApiCircuitFailure', () => {
  it('treats 404 as healthy API (missing data)', () => {
    expect(isArchivesApiCircuitFailure('http', 404)).toBe(false)
  })

  it('treats 5xx and network/parse as service failures', () => {
    expect(isArchivesApiCircuitFailure('http', 500)).toBe(true)
    expect(isArchivesApiCircuitFailure('http', 503)).toBe(true)
    expect(isArchivesApiCircuitFailure('network')).toBe(true)
    expect(isArchivesApiCircuitFailure('parse')).toBe(true)
  })

  it('does not trip circuit on other 4xx', () => {
    expect(isArchivesApiCircuitFailure('http', 400)).toBe(false)
    expect(isArchivesApiCircuitFailure('http', 403)).toBe(false)
  })
})

describe('NostrArchivesApiService', () => {
  it('is permanently disabled (relay/local fallbacks only)', async () => {
    expect(nostrArchivesApi.isEnabled()).toBe(false)
    expect(nostrArchivesApi.isAvailable()).toBe(false)
    const res = await nostrArchivesApi.getEventById(EVENT_ID)
    expect(res).toEqual({ ok: false, reason: 'disabled' })
  })
})
