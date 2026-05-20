import { describe, expect, it } from 'vitest'
import {
  extractAboutCoinPaymentMethods,
  parseAboutCoinLabelPaymentLines
} from './payto-about-coin-lines'
import { extractKind0PaymentMethodsFromProfileJson } from './payto-kind0-import'

const XMR_ADDR =
  '84mAJEgdihyRHkz8fGeuqgbQ19SuGeFWbhokJG2uMNMwTkDyoyQ3H7BijQNwSriSp9hHfaRGZYpCuKvHJwTer8av845U9py'

describe('parseAboutCoinLabelPaymentLines', () => {
  it('parses XMR: line in profile about', () => {
    const about = `https://pubky.app/profile/foo\n\nXMR: ${XMR_ADDR}\n\nSimpleX: https://smp17.simplex.im/a#test`
    const matches = parseAboutCoinLabelPaymentLines(about)
    expect(matches).toHaveLength(1)
    expect(matches[0].paytoType).toBe('monero')
    expect(matches[0].authority).toBe(XMR_ADDR)
    expect(matches[0].payto).toBe(`payto://monero/${encodeURIComponent(XMR_ADDR)}`)
  })
})

describe('extractKind0PaymentMethodsFromProfileJson about', () => {
  it('imports monero from about coin line', () => {
    const methods = extractKind0PaymentMethodsFromProfileJson({
      about: `XMR: ${XMR_ADDR}`
    })
    expect(methods.some((m) => m.type === 'monero' && m.authority === XMR_ADDR)).toBe(true)
  })
})

describe('extractAboutCoinPaymentMethods', () => {
  it('dedupes repeated labels', () => {
    const methods = extractAboutCoinPaymentMethods(`XMR: ${XMR_ADDR}\nXMR: ${XMR_ADDR}`)
    expect(methods).toHaveLength(1)
  })
})
