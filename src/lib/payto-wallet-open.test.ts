import { describe, expect, it } from 'vitest'
import { getPaytoProfileUrl } from '@/lib/payto-registry'
import {
  buildBlueWalletWalletHref,
  buildPhoenixWalletHref,
  buildZeusWalletHref,
  filterPaytoPaymentOpenHandlersForDevice,
  filterWalletOpenActionsForDevice,
  getLightningInvoiceWalletPaymentHandlers,
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

  it('builds Phoenix and Zeus bolt12 deep links from offer string', () => {
    const offer = 'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283qfwdpl28qqmc78ymlvhmxcsywdk5wrjnj36ryg488qwlrnzyjczs'
    const actions = getPaytoWalletOpenActions('bolt12', offer)
    expect(actions).toHaveLength(2)
    expect(actions.map((a) => a.label).sort()).toEqual(['Phoenix', 'Zeus'])
    expect(actions.find((a) => a.label === 'Phoenix')?.href).toBe(`phoenix:bolt12:${offer}`)
    expect(actions.find((a) => a.label === 'Zeus')?.href).toBe(`zeusln:${offer}`)
  })

  it('builds Phoenix lightning deep link without pay?uri query', () => {
    expect(buildPhoenixWalletHref('lightning', 'user@example.com')).toBe(
      'phoenix:lightning:user@example.com'
    )
    expect(buildPhoenixWalletHref('lightning', 'lnbc1p0example')).toBe('phoenix:lightning:lnbc1p0example')
    expect(buildPhoenixWalletHref('lightning', 'lightning:lnbc1p0example')).toBe(
      'phoenix:lightning:lnbc1p0example'
    )
  })

  it('omits mobile lightning wallets for lightning address until BOLT11 is supplied separately', () => {
    const handlers = getPaytoPaymentOpenHandlers('lightning', 'user@example.com')
    expect(handlers.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(handlers.some((h) => h.openTargetName === 'Zeus')).toBe(false)
    expect(handlers.some((h) => h.openTargetName === 'BlueWallet')).toBe(false)
  })

  it('includes Phoenix and Zeus on mobile only for bip353', () => {
    const handlers = getPaytoPaymentOpenHandlers('bip353', 'user@example.com')
    const phoenix = handlers.find((h) => h.openTargetName === 'Phoenix')
    const zeus = handlers.find((h) => h.openTargetName === 'Zeus')
    expect(phoenix?.href).toBe('phoenix:lightning:user@example.com')
    expect(zeus?.href).toBe('zeusln:lightning:user@example.com')
    expect(phoenix?.mobileOnly).toBe(true)
    expect(zeus?.mobileOnly).toBe(true)

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

  it('builds Zeus and BlueWallet BOLT11 deep links', () => {
    expect(buildZeusWalletHref('lightning', 'lnbc1p0example')).toBe('zeusln:lightning:lnbc1p0example')
    expect(buildZeusWalletHref('lightning', 'lightning:lnbc1p0example')).toBe(
      'zeusln:lightning:lnbc1p0example'
    )
    expect(buildBlueWalletWalletHref('lnbc1p0example')).toBe('bluewallet:lightning:lnbc1p0example')
    expect(buildBlueWalletWalletHref('lightning:lnbc1p0example')).toBe(
      'bluewallet:lightning:lnbc1p0example'
    )
  })

  it('lists Phoenix, Zeus, and BlueWallet for a resolved BOLT11 invoice', () => {
    const invoice = 'lnbc1p0example'
    const handlers = getLightningInvoiceWalletPaymentHandlers(invoice)
    expect(handlers.map((h) => h.openTargetName).sort()).toEqual(['BlueWallet', 'Phoenix', 'Zeus'])
    expect(handlers.find((h) => h.openTargetName === 'Phoenix')?.href).toBe(
      `phoenix:lightning:${invoice}`
    )
    expect(handlers.find((h) => h.openTargetName === 'Zeus')?.href).toBe(`zeusln:lightning:${invoice}`)
    expect(handlers.find((h) => h.openTargetName === 'BlueWallet')?.href).toBe(
      `bluewallet:lightning:${invoice}`
    )
  })

  it('scopes lightning BOLT11 handlers to lightning payto only', () => {
    const invoice = 'lnbc1p0example'
    const lightning = getPaytoPaymentOpenHandlers('lightning', 'user@example.com', {
      bolt11Invoice: invoice
    })
    expect(lightning.map((h) => h.openTargetName).sort()).toEqual(['BlueWallet', 'Phoenix', 'Zeus'])
    expect(lightning.some((h) => h.openTargetName === 'PayPal')).toBe(false)

    const moneroAddr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const moneroWithBolt11 = getPaytoPaymentOpenHandlers('monero', moneroAddr, { bolt11Invoice: invoice })
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'Zeus')).toBe(false)
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'BlueWallet')).toBe(false)
    expect(
      getPaytoPaymentOpenHandlers('paypal', 'someuser', { bolt11Invoice: invoice }).map((h) => h.openTargetName)
    ).toEqual(['PayPal'])
  })

  it('never mixes fiat web links or lightning wallets across payto types', () => {
    const monero = getPaytoPaymentOpenHandlers(
      'monero',
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    )
    expect(monero.some((h) => h.openTargetName === 'PayPal')).toBe(false)
    expect(monero.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(monero.some((h) => h.openTargetName === 'Cake Wallet')).toBe(true)

    const cash = getPaytoPaymentOpenHandlers('cashme', '$cashtag')
    expect(cash).toHaveLength(1)
    expect(cash[0].openTargetName).toBe('Cash App')
    expect(cash.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
  })
})

describe('isPaytoHttpOpenUrl', () => {
  it('distinguishes https profile links from wallet schemes', () => {
    expect(isPaytoHttpOpenUrl('https://paypal.me/foo')).toBe(true)
    expect(isPaytoHttpOpenUrl('monero:4abc')).toBe(false)
  })
})
