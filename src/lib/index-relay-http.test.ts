import {
  IndexRelayTransportError,
  clearDevIndexRelayUnavailableThisSession,
  isDevIndexRelayUnavailableThisSession,
  isIndexRelayTransportFailure
} from '@/lib/index-relay-http'
import { describe, expect, it, beforeEach } from 'vitest'

describe('isIndexRelayTransportFailure', () => {
  it('treats IndexRelayTransportError as transport failure', () => {
    expect(isIndexRelayTransportFailure(new IndexRelayTransportError())).toBe(true)
    expect(isIndexRelayTransportFailure(new IndexRelayTransportError(new Error('HTTP 500')))).toBe(true)
  })

  it('treats network TypeError as transport failure', () => {
    expect(isIndexRelayTransportFailure(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('dev index relay session skip', () => {
  beforeEach(() => {
    clearDevIndexRelayUnavailableThisSession()
  })

  it('starts available after clear', () => {
    expect(isDevIndexRelayUnavailableThisSession()).toBe(false)
  })
})
