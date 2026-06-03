import { describe, expect, it } from 'vitest'
import { isRelayAuthAccessDeniedMessage } from './relay-nip42-auth'

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
})
