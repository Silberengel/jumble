import { describe, expect, it } from 'vitest'
import {
  buildLnurlPayCallbackUrl,
  parseLnurlCommentAllowed
} from './lnurl-pay'

describe('parseLnurlCommentAllowed', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseLnurlCommentAllowed(255)).toBe(255)
    expect(parseLnurlCommentAllowed('1024')).toBe(1024)
    expect(parseLnurlCommentAllowed('0')).toBe(0)
  })

  it('returns 0 for missing or invalid values', () => {
    expect(parseLnurlCommentAllowed(undefined)).toBe(0)
    expect(parseLnurlCommentAllowed('')).toBe(0)
    expect(parseLnurlCommentAllowed('nope')).toBe(0)
  })
})

describe('buildLnurlPayCallbackUrl', () => {
  it('merges params into callbacks that already have a query string', () => {
    const out = buildLnurlPayCallbackUrl('https://pay.example/cb?tag=payRequest', {
      amount: '21000',
      comment: 'hello tip'
    })
    const url = new URL(out)
    expect(url.searchParams.get('tag')).toBe('payRequest')
    expect(url.searchParams.get('amount')).toBe('21000')
    expect(url.searchParams.get('comment')).toBe('hello tip')
  })

  it('encodes unicode in comments', () => {
    const out = buildLnurlPayCallbackUrl('https://pay.example/cb', {
      amount: '1000',
      comment: 'café ☕'
    })
    expect(out).toContain('comment=')
    expect(decodeURIComponent(new URL(out).searchParams.get('comment') ?? '')).toBe('café ☕')
  })
})
