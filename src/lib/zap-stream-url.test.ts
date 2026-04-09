import { describe, expect, it } from 'vitest'
import { canonicalZapStreamWatchUrl, isZapStreamWatchUrl } from './zap-stream-url'

const SAMPLE =
  'https://zap.stream/naddr1qqjrqcmzv3nr2des95ergdp3956xzdf595uxzefk94nxzefnxgukycnzxyexyqgewaehxw309aex2mrp0yh8xmn0wf6zuum0vd5kzmp0qgsv73dxhgfk8tt76gf6q788zrfyz9dwwgwfk3aar6l5gk82a76v9fgrqsqqqan84z6qnu'

describe('zap-stream-url', () => {
  it('canonicalizes valid zap.stream naddr URLs', () => {
    expect(canonicalZapStreamWatchUrl(SAMPLE)).toBe(SAMPLE)
    expect(canonicalZapStreamWatchUrl('http://zap.stream/naddr1qqqq')).toBe(
      'https://zap.stream/naddr1qqqq',
    )
    expect(canonicalZapStreamWatchUrl('https://www.zap.stream/naddr1qqqq')).toBe(
      'https://zap.stream/naddr1qqqq',
    )
  })

  it('preserves query on canonical URL', () => {
    expect(canonicalZapStreamWatchUrl(`${SAMPLE}?t=1`)).toBe(`${SAMPLE}?t=1`)
  })

  it('rejects non-watch URLs', () => {
    expect(canonicalZapStreamWatchUrl('https://zap.stream/')).toBeNull()
    expect(canonicalZapStreamWatchUrl('https://zap.stream/foo/bar')).toBeNull()
    expect(canonicalZapStreamWatchUrl('https://example.com/naddr1qqqq')).toBeNull()
    expect(canonicalZapStreamWatchUrl('https://zap.stream/npub1qqqq')).toBeNull()
    expect(canonicalZapStreamWatchUrl('https://zap.stream/naddr1')).toBeNull()
    expect(canonicalZapStreamWatchUrl('https://zap.stream/naddr1!bad')).toBeNull()
  })

  it('isZapStreamWatchUrl mirrors canonical', () => {
    expect(isZapStreamWatchUrl(SAMPLE)).toBe(true)
    expect(isZapStreamWatchUrl('https://zap.stream/')).toBe(false)
  })
})
