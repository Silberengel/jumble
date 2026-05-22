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

  it('remembers failed domains for the session', () => {
    const host = `fail-cache-test-${Date.now()}.example`
    expect(isFaviconLoadFailed(host)).toBe(false)
    markFaviconLoadFailed(host)
    expect(isFaviconLoadFailed(host)).toBe(true)
    expect(isFaviconLoadFailed(host.toUpperCase())).toBe(true)
  })
})
