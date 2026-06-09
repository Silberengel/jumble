import { describe, expect, it } from 'vitest'
import {
  isFaviconLoadFailed,
  markFaviconLoadFailed,
  normalizeFaviconDomain
} from '@/lib/favicon-fail-cache'

describe('favicon-fail-cache', () => {
  it('normalizes domain casing and trailing dot', () => {
    expect(normalizeFaviconDomain(' Example.COM. ')).toBe('example.com')
  })

  it('remembers failed icon URLs for the session', () => {
    const iconSrc = `https://fail-cache-test-${Date.now()}.example/favicon.ico`
    expect(isFaviconLoadFailed(iconSrc)).toBe(false)
    markFaviconLoadFailed(iconSrc)
    expect(isFaviconLoadFailed(iconSrc)).toBe(true)
  })

  it('does not block override URLs when default favicon failed for the same domain', () => {
    const defaultSrc = 'https://xmr.rocks/favicon.ico'
    const overrideSrc = 'https://nostr.xmr.rocks/static/assets/nerostr.webp'
    markFaviconLoadFailed(defaultSrc)
    expect(isFaviconLoadFailed(defaultSrc)).toBe(true)
    expect(isFaviconLoadFailed(overrideSrc)).toBe(false)
  })
})
