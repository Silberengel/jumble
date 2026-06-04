import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nostrArchivesApi, { isArchivesApiCircuitFailure } from '@/services/nostr-archives-api.service'

vi.mock('@/services/local-storage.service', () => ({
  default: {
    getUseNostrArchivesApi: () => true
  }
}))

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

describe('NostrArchivesApiService circuit breaker', () => {
  beforeEach(() => {
    nostrArchivesApi.resetForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    nostrArchivesApi.resetForTests()
  })

  it('returns not_found for 404 without opening the circuit', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await nostrArchivesApi.getEventById(EVENT_ID)
    const second = await nostrArchivesApi.getEventById(EVENT_ID)

    expect(first).toEqual({ ok: false, reason: 'not_found', status: 404 })
    expect(second).toEqual({ ok: false, reason: 'not_found', status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(nostrArchivesApi.isAvailable()).toBe(true)
  })

  it('dedupes concurrent getEventById for the same id', async () => {
    let resolveFetch!: () => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response('not found', { status: 404 }))
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const a = nostrArchivesApi.getEventById(EVENT_ID)
    const b = nostrArchivesApi.getEventById(EVENT_ID)
    resolveFetch()
    await Promise.all([a, b])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opens circuit after repeated 5xx errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 503 }))
    )

    await nostrArchivesApi.getEventById(EVENT_ID)
    await nostrArchivesApi.getEventById(EVENT_ID)

    expect(nostrArchivesApi.isAvailable()).toBe(false)

    const blocked = await nostrArchivesApi.getEventById(EVENT_ID)
    expect(blocked).toEqual({ ok: false, reason: 'circuit_open' })
  })

  it('does not open circuit on request timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
      )
    )

    await nostrArchivesApi.getEventById(EVENT_ID)
    await nostrArchivesApi.getEventById(EVENT_ID)

    expect(nostrArchivesApi.isAvailable()).toBe(true)
  })
})
