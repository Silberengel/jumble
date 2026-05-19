import { describe, expect, it } from 'vitest'
import { resolvePaypalPaymentUrl } from './payto-paypal-url'

describe('resolvePaypalPaymentUrl', () => {
  it('maps paypal.com/paypalme slug to paypal.me', () => {
    expect(resolvePaypalPaymentUrl('https://www.paypal.com/paypalme/2rizmo%40gmail.com')).toBe(
      'https://paypal.me/2rizmo@gmail.com'
    )
  })

  it('passes through donate links', () => {
    const donate = 'https://www.paypal.com/donate/?hosted_button_id=T32KCSU8EZTBL'
    expect(resolvePaypalPaymentUrl(donate)).toBe(donate)
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
  })

  it('normalizes paypal.me path', () => {
    expect(resolvePaypalPaymentUrl('https://paypal.me/foo')).toBe('https://paypal.me/foo')
  })
})
