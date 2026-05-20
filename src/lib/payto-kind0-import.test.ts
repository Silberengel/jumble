import { describe, expect, it } from 'vitest'
import { extractKind0PaymentMethodsFromProfileJson } from './payto-kind0-import'

describe('extractKind0PaymentMethodsFromProfileJson', () => {
  it('imports Garnet cryptocurrency_addresses.monero', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const methods = extractKind0PaymentMethodsFromProfileJson({
      cryptocurrency_addresses: { monero: addr }
    })
    expect(methods).toHaveLength(1)
    expect(methods[0].type).toBe('monero')
    expect(methods[0].authority).toBe(addr)
    expect(methods[0].payto).toBe(`payto://monero/${addr}`)
  })

  it('maps xmr alias to monero', () => {
    const methods = extractKind0PaymentMethodsFromProfileJson({
      cryptocurrency_addresses: { xmr: '4abc' }
    })
    expect(methods[0]?.type).toBe('monero')
  })

  it('reads bare root monero key', () => {
    const methods = extractKind0PaymentMethodsFromProfileJson({
      monero: '4root'
    })
    expect(methods[0]?.authority).toBe('4root')
  })

  it('dedupes cryptocurrency_addresses and root field', () => {
    const methods = extractKind0PaymentMethodsFromProfileJson({
      monero: '4same',
      cryptocurrency_addresses: { monero: '4same' }
    })
    expect(methods).toHaveLength(1)
  })
})
