import { describe, expect, it } from 'vitest'
import { normalizePaypalAuthority, resolvePaypalPaymentUrl } from './payto-paypal-url'

describe('resolvePaypalPaymentUrl', () => {
  it('maps paypal.com/paypalme slug to paypal.me', () => {
    expect(resolvePaypalPaymentUrl('https://www.paypal.com/paypalme/2rizmo%40gmail.com')).toBe(
      'https://paypal.me/2rizmo%40gmail.com'
    )
  })

  it('resolves donate links with and without https', () => {
    const canonical = 'https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL'
    expect(resolvePaypalPaymentUrl('https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')).toBe(
      canonical
    )
    expect(resolvePaypalPaymentUrl('www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')).toBe(
      canonical
    )
    expect(resolvePaypalPaymentUrl('paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')).toBe(
      canonical
    )
  })

  it('maps legacy webscr hosted buttons to donate URLs', () => {
    expect(
      resolvePaypalPaymentUrl(
        'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=T32KCSU8EZTBL'
      )
    ).toBe('https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')
  })

  it('unwraps YouTube redirect q= PayPal URL', () => {
    const yt =
      'https://www.youtube.com/redirect?event=channel_description&redir_token=abc&q=https%3A%2F%2Fwww.paypal.com%2Fdonate%2F%3Fhosted_button_id%3DT32KCSU8EZTBL'
    expect(resolvePaypalPaymentUrl(yt)).toBe(
      'https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL'
    )
  })

  it('builds paypal.me from bare username', () => {
    expect(resolvePaypalPaymentUrl('somecreator')).toBe('https://paypal.me/somecreator')
    expect(resolvePaypalPaymentUrl('https://www.paypal.com/paypalme/2rizmo@gmail.com')).toBe(
      'https://paypal.me/2rizmo%40gmail.com'
    )
  })

  it('normalizes paypal.me path', () => {
    expect(resolvePaypalPaymentUrl('https://paypal.me/foo')).toBe('https://paypal.me/foo')
  })

  it('handles www.paypal.me profile links', () => {
    expect(resolvePaypalPaymentUrl('https://www.paypal.me/user38910')).toBe('https://paypal.me/user38910')
    expect(resolvePaypalPaymentUrl('www.paypal.me/user38910')).toBe('https://paypal.me/user38910')
  })

  it('unwraps payto://paypal/… authorities', () => {
    expect(resolvePaypalPaymentUrl('payto://paypal/https://www.paypal.me/user38910')).toBe(
      'https://paypal.me/user38910'
    )
    expect(resolvePaypalPaymentUrl('payto://paypal/user38910')).toBe('https://paypal.me/user38910')
    expect(
      resolvePaypalPaymentUrl('payto://paypal/www.paypal.com/donate/?hosted_button_id=ABC')
    ).toBe('https://www.paypal.com/donate/?hosted_button_id=ABC')
  })

  it('passes through pool and campaign donate URLs with https', () => {
    const pool = 'https://www.paypal.com/pools/c/abc123'
    expect(resolvePaypalPaymentUrl(pool)).toBe(pool)
    const campaign = 'https://www.paypal.com/donate/?campaign_id=foo'
    expect(resolvePaypalPaymentUrl(campaign)).toBe(campaign)
  })
})

describe('normalizePaypalAuthority', () => {
  it('extracts username from PayPal.Me URLs', () => {
    expect(normalizePaypalAuthority('https://www.paypal.me/user38910')).toBe('user38910')
    expect(normalizePaypalAuthority('user38910')).toBe('user38910')
  })

  it('stores canonical donation URLs', () => {
    expect(
      normalizePaypalAuthority('www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')
    ).toBe('https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')
    expect(
      normalizePaypalAuthority(
        'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=T32KCSU8EZTBL'
      )
    ).toBe('https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL')
  })
})
