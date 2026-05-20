import { describe, expect, it } from 'vitest'
import { getPaytoProfileUrl } from '@/lib/payto-registry'
import {
  filterPaytoPaymentOpenHandlersForDevice,
  filterWalletOpenActionsForDevice,
  getPaytoPaymentOpenHandlers,
  getPaytoPrimaryOpenUrl,
  getPaytoWalletOpenActions,
  isPaytoHttpOpenUrl
} from './payto-wallet-open'

describe('getPaytoPrimaryOpenUrl', () => {
  it('builds monero: URI for primary address', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    expect(getPaytoPrimaryOpenUrl('monero', addr)).toBe(`monero:${addr}`)
    expect(getPaytoProfileUrl('monero', addr)).toBe(`monero:${addr}`)
  })

  it('builds bitcoin: URI', () => {
    expect(getPaytoPrimaryOpenUrl('bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    )
  })

  it('maps BIP-353 human-readable name to lightning: URI', () => {
    expect(getPaytoPrimaryOpenUrl('bip353', 'user@example.com')).toBe('lightning:user@example.com')
  })

  it('maps BIP-352 silent payment to bitcoin: URI', () => {
    const sp = 'sp1qxyz'
    expect(getPaytoPrimaryOpenUrl('bip352', sp)).toBe(`bitcoin:${sp}`)
  })

  it('requires lno1 prefix for bolt12', () => {
    expect(getPaytoPrimaryOpenUrl('bolt12', 'lno1offer')).toBe('bolt12:lno1offer')
    expect(getPaytoPrimaryOpenUrl('bolt12', 'bc1qinvalid')).toBeNull()
  })
})

describe('getPaytoWalletOpenActions', () => {
  it('includes Cake Wallet deep link for monero', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const actions = getPaytoWalletOpenActions('monero', addr)
    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('Cake Wallet')
    expect(actions[0].href).toBe(`cakewallet:monero?address=${addr}`)
    expect(actions[0].mobileOnly).toBe(true)
  })

  it('hides mobile-only actions on desktop UA', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const actions = getPaytoWalletOpenActions('monero', addr)
    const prev = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
      configurable: true
    })
    try {
      expect(filterWalletOpenActionsForDevice(actions)).toHaveLength(0)
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: prev, configurable: true })
    }
  })
})

describe('getPaytoPaymentOpenHandlers', () => {
  it('lists named apps only, not native coin schemes', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const monero = getPaytoPaymentOpenHandlers('monero', addr)
    expect(monero.some((h) => h.openTargetName === 'Cake Wallet')).toBe(true)
    expect(monero.some((h) => h.href.startsWith('monero:'))).toBe(false)

    const btc = getPaytoWalletOpenActions('bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
    expect(btc[0]?.href).toBe(
      'cakewallet:bitcoin?address=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    )

    const sp = getPaytoWalletOpenActions('bip352', 'sp1qxyz0123456789')
    expect(sp[0]?.href).toBe('cakewallet:bitcoin?address=sp1qxyz0123456789')

    const cash = getPaytoPaymentOpenHandlers('cashme', '$cashtag')
    expect(cash).toHaveLength(1)
    expect(cash[0].isHttp).toBe(true)
    expect(cash[0].openTargetName).toBe('Cash App')
    expect(cash[0].href).toBe('https://cash.app/%24cashtag')
  })

  it('builds Phoenix bolt12 deep link from offer string', () => {
    const offer = 'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283qfwdpl28qqmc78ymlvhmxcsywdk5wrjnj36ryg488qwlrnzyjczs'
    const actions = getPaytoWalletOpenActions('bolt12', offer)
    expect(actions).toHaveLength(1)
    expect(actions[0].href).toBe(`phoenix:pay?uri=bolt12:${offer}`)
    expect(actions[0].mobileOnly).toBe(true)
  })

  it('includes Phoenix on mobile only', () => {
    const handlers = getPaytoPaymentOpenHandlers('lightning', 'user@example.com')
    const phoenix = handlers.find((h) => h.openTargetName === 'Phoenix')
    expect(phoenix?.mobileOnly).toBe(true)

    const prev = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
      configurable: true
    })
    try {
      expect(
        filterPaytoPaymentOpenHandlersForDevice(handlers).some((h) => h.openTargetName === 'Phoenix')
      ).toBe(false)
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: prev, configurable: true })
    }
  })
})

describe('isPaytoHttpOpenUrl', () => {
  it('distinguishes https profile links from wallet schemes', () => {
    expect(isPaytoHttpOpenUrl('https://paypal.me/foo')).toBe(true)
    expect(isPaytoHttpOpenUrl('monero:4abc')).toBe(false)
  })
})
