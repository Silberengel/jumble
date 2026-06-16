import { describe, expect, it } from 'vitest'
import {
  isRelayAuthAccessDeniedMessage,
  isRelayAuthTransientFailureMessage
} from './relay-nip42-auth'

describe('isRelayAuthAccessDeniedMessage', () => {
  it('detects Essayist-style membership restriction', () => {
    expect(isRelayAuthAccessDeniedMessage('restricted: active Essayist membership required')).toBe(
      true
    )
  })

  it('does not treat auth-required as access denied', () => {
    expect(isRelayAuthAccessDeniedMessage('auth-required')).toBe(false)
    expect(isRelayAuthAccessDeniedMessage('auth-required: please authenticate')).toBe(false)
  })

  it('detects other permanent denial patterns', () => {
    expect(isRelayAuthAccessDeniedMessage('forbidden: not on allowlist')).toBe(true)
    expect(isRelayAuthAccessDeniedMessage('membership required')).toBe(true)
    expect(isRelayAuthAccessDeniedMessage('access denied')).toBe(true)
  })

  it('ignores empty messages', () => {
    expect(isRelayAuthAccessDeniedMessage('')).toBe(false)
    expect(isRelayAuthAccessDeniedMessage('   ')).toBe(false)
  })

  it('does not treat transient membership backend errors as access denied', () => {
    expect(isRelayAuthAccessDeniedMessage('error: membership check temporarily unavailable')).toBe(
      false
    )
  })
})

describe('isRelayAuthTransientFailureMessage', () => {
  it('detects Essayist-style transient membership check failure', () => {
    expect(
      isRelayAuthTransientFailureMessage('error: membership check temporarily unavailable')
    ).toBe(true)
  })

  it('detects other transient outage patterns', () => {
    expect(isRelayAuthTransientFailureMessage('service unavailable')).toBe(true)
    expect(isRelayAuthTransientFailureMessage('try again later')).toBe(true)
  })

  it('does not treat permanent denial as transient', () => {
    expect(isRelayAuthTransientFailureMessage('membership required')).toBe(false)
    expect(isRelayAuthTransientFailureMessage('restricted: active Essayist membership required')).toBe(
      false
    )
  })
})
