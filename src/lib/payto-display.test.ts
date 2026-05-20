import { describe, expect, it } from 'vitest'
import {
  formatPaytoLinkDisplayText,
  paytoLinkChildTextLooksLikeAuthority,
  truncatePaytoAuthority
} from './payto-display'

describe('truncatePaytoAuthority', () => {
  it('returns full string when within limit', () => {
    expect(truncatePaytoAuthority('derjuergen')).toBe('derjuergen')
  })

  it('truncates to 10 characters', () => {
    expect(truncatePaytoAuthority('47R4NpvudmrLkLxaf4Uy')).toBe('47R4Npvudm')
  })
})

describe('formatPaytoLinkDisplayText', () => {
  it('formats long monero address with label', () => {
    expect(
      formatPaytoLinkDisplayText('monero', '47R4NpvudmrLkLxaf4Uyiq56weFDZko1KeFrY5qUgnJ95X3D1YWYRVASAnMLBgpB5BeSViAVaxLXuFDuup15j3f45NC2WUp')
    ).toBe('47R4Npvudm... (Monero)')
  })

  it('formats short paypal handle without ellipsis', () => {
    expect(formatPaytoLinkDisplayText('paypal', 'derjuergen')).toBe('derjuergen (PayPal)')
  })
})

describe('paytoLinkChildTextLooksLikeAuthority', () => {
  it('detects full authority as link text', () => {
    const auth = '47R4NpvudmrLkLxaf4Uy'
    expect(paytoLinkChildTextLooksLikeAuthority(auth, auth, `payto://monero/${auth}`)).toBe(true)
  })

  it('keeps custom link text', () => {
    expect(paytoLinkChildTextLooksLikeAuthority('Donate via PayPal', 'derjuergen', 'payto://paypal/derjuergen')).toBe(
      false
    )
  })
})
