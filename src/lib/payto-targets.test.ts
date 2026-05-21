import { describe, expect, it } from 'vitest'
import {
  buildLedgerWalletHref,
  buildPhoenixWalletHref,
  filterPaytoPaymentOpenHandlersForDevice,
  isPaytoHttpOpenUrl,
  resolveNativeWalletUri,
  resolvePaytoPaymentOpenHandlers,
  resolvePaytoProfileUrl
} from './payto-targets'

describe('resolveNativeWalletUri', () => {
  it('builds monero: URI for primary address', () => {
    const addr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    expect(
      resolveNativeWalletUri('monero', addr, { scheme: 'monero', walletApps: ['cakewallet'] })
    ).toBe(`monero:${addr}`)
    expect(resolvePaytoProfileUrl('monero', addr)).toBe(`monero:${addr}`)
  })

  it('builds bitcoin: URI', () => {
    expect(
      resolveNativeWalletUri('bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        scheme: 'bitcoin',
        walletApps: ['cakewallet']
      })
    ).toBe('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
  })

  it('maps BIP-353 to lightning: URI', () => {
    expect(
      resolveNativeWalletUri('bip353', 'user@example.com', {
        scheme: 'lightning',
        requireAtSign: true,
        walletApps: ['phoenix', 'zeus']
      })
    ).toBe('lightning:user@example.com')
  })

  it('requires lno1 prefix for bolt12', () => {
    expect(
      resolveNativeWalletUri('bolt12', 'lno1offer', {
        scheme: 'bolt12',
        requirePrefix: 'lno1',
        walletApps: ['phoenix', 'zeus']
      })
    ).toBe('bolt12:lno1offer')
    expect(
      resolveNativeWalletUri('bolt12', 'bc1qinvalid', {
        scheme: 'bolt12',
        requirePrefix: 'lno1',
        walletApps: ['phoenix']
      })
    ).toBeNull()
  })
})

describe('resolvePaytoPaymentOpenHandlers', () => {
  it('includes Cake Wallet and Ledger Live for monero', () => {
    const addr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const handlers = resolvePaytoPaymentOpenHandlers('monero', addr)
    const cake = handlers.find((h) => h.openTargetName === 'Cake Wallet')
    expect(cake).toBeDefined()
    expect(cake?.href).toBe(`cakewallet:monero?address=${addr}`)
    expect(cake?.mobileOnly).toBe(true)
    const ledger = handlers.find((h) => h.openTargetName === 'Ledger Live')
    expect(ledger?.href).toBe(
      `ledgerlive://send?currency=monero&recipient=${encodeURIComponent(addr)}`
    )
    expect(ledger?.mobileOnly).toBe(false)
  })

  it('builds Ledger Live send deeplink for on-chain types only', () => {
    const btc = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    expect(buildLedgerWalletHref('bitcoin', btc)).toBe(
      `ledgerlive://send?currency=bitcoin&recipient=${encodeURIComponent(btc)}`
    )
    expect(buildLedgerWalletHref('lightning', 'lnbc1p0example')).toBeNull()
    expect(
      resolvePaytoPaymentOpenHandlers('lightning', 'user@example.com', {
        bolt11Invoice: 'lnbc1p0example'
      }).some((h) => h.openTargetName === 'Ledger Live')
    ).toBe(false)
  })

  it('hides mobile-only handlers on desktop UA but keeps Ledger Live', () => {
    const addr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const handlers = resolvePaytoPaymentOpenHandlers('monero', addr)
    const prev = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
      configurable: true
    })
    try {
      const visible = filterPaytoPaymentOpenHandlersForDevice(handlers)
      expect(visible.some((h) => h.openTargetName === 'Cake Wallet')).toBe(false)
      expect(visible.some((h) => h.openTargetName === 'Ledger Live')).toBe(true)
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: prev, configurable: true })
    }
  })

  it('lists named apps only, not native coin schemes', () => {
    const addr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const monero = resolvePaytoPaymentOpenHandlers('monero', addr)
    expect(monero.some((h) => h.openTargetName === 'Cake Wallet')).toBe(true)
    expect(monero.some((h) => h.href.startsWith('monero:'))).toBe(false)

    const btc = resolvePaytoPaymentOpenHandlers('bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
    expect(btc.find((h) => h.openTargetName === 'Cake Wallet')?.href).toBe(
      'cakewallet:bitcoin?address=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    )

    const sp = resolvePaytoPaymentOpenHandlers('bip352', 'sp1qxyz0123456789')
    expect(sp.find((h) => h.openTargetName === 'Cake Wallet')?.href).toBe(
      'cakewallet:bitcoin?address=sp1qxyz0123456789'
    )

    const cash = resolvePaytoPaymentOpenHandlers('cashme', '$cashtag')
    expect(cash).toHaveLength(1)
    expect(cash[0].isHttp).toBe(true)
    expect(cash[0].openTargetName).toBe('Cash App')
    expect(cash[0].href).toBe('https://cash.app/%24cashtag')
  })

  it('builds bolt12 deep links from offer string', () => {
    const offer =
      'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283qfwdpl28qqmc78ymlvhmxcsywdk5wrjnj36ryg488qwlrnzyjczs'
    const handlers = resolvePaytoPaymentOpenHandlers('bolt12', offer)
    expect(handlers.find((h) => h.openTargetName === 'Phoenix')?.href).toBe(`phoenix:bolt12:${offer}`)
    expect(handlers.find((h) => h.openTargetName === 'Zeus')?.href).toBe(`zeusln:${offer}`)
    expect(handlers.find((h) => h.openTargetName === 'Blixt')?.href).toBe(`blixtwallet:${offer}`)
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

  it('omits mobile lightning wallets for lightning address until BOLT11 is supplied', () => {
    const handlers = resolvePaytoPaymentOpenHandlers('lightning', 'user@example.com')
    expect(handlers.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(handlers.some((h) => h.openTargetName === 'Zeus')).toBe(false)
    expect(handlers.some((h) => h.openTargetName === 'BlueWallet')).toBe(false)
  })

  it('includes lightning wallet apps on mobile only for bip353', () => {
    const handlers = resolvePaytoPaymentOpenHandlers('bip353', 'user@example.com')
    const phoenix = handlers.find((h) => h.openTargetName === 'Phoenix')
    const muun = handlers.find((h) => h.openTargetName === 'Muun')
    expect(phoenix?.href).toBe('phoenix:lightning:user@example.com')
    expect(muun?.href).toBe('muun:lightning:user@example.com')
    expect(phoenix?.mobileOnly).toBe(true)
    expect(muun?.mobileOnly).toBe(true)
    expect(handlers.some((h) => h.openTargetName === 'Blink')).toBe(true)
    expect(handlers.some((h) => h.openTargetName === 'Blixt')).toBe(false)

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

  it('lists lightning wallet apps for a resolved BOLT11 invoice', () => {
    const invoice = 'lnbc1p0example'
    const handlers = resolvePaytoPaymentOpenHandlers('lightning', 'user@example.com', {
      bolt11Invoice: invoice
    })
    const names = handlers.map((h) => h.openTargetName).sort()
    expect(names).toEqual([
      'Alby',
      'Bitkit',
      'Blink',
      'Blockstream Green',
      'BlueWallet',
      'Breez',
      'Muun',
      'Phoenix',
      'Wallet of Satoshi',
      'Zeus'
    ])
    expect(handlers.find((h) => h.openTargetName === 'Phoenix')?.href).toBe(
      `phoenix:lightning:${invoice}`
    )
    expect(handlers.find((h) => h.openTargetName === 'Zeus')?.href).toBe(`zeusln:lightning:${invoice}`)
    expect(handlers.find((h) => h.openTargetName === 'BlueWallet')?.href).toBe(
      `bluewallet:lightning:${invoice}`
    )
    expect(handlers.find((h) => h.openTargetName === 'Muun')?.href).toBe(`muun:lightning:${invoice}`)
    expect(handlers.find((h) => h.openTargetName === 'Wallet of Satoshi')?.href).toBe(
      `walletofsatoshi:lightning:${invoice}`
    )
    expect(handlers.find((h) => h.openTargetName === 'Blink')?.href).toBe(`blink:lightning:${invoice}`)
    expect(handlers.find((h) => h.openTargetName === 'Breez')?.href).toBe(`breez:${invoice}`)
    expect(handlers.find((h) => h.openTargetName === 'Alby')?.href).toBe(`alby:lightning:${invoice}`)
  })

  it('scopes lightning BOLT11 handlers to lightning payto only', () => {
    const invoice = 'lnbc1p0example'
    const lightning = resolvePaytoPaymentOpenHandlers('lightning', 'user@example.com', {
      bolt11Invoice: invoice
    })
    expect(lightning.map((h) => h.openTargetName).sort()).toEqual([
      'Alby',
      'Bitkit',
      'Blink',
      'Blockstream Green',
      'BlueWallet',
      'Breez',
      'Muun',
      'Phoenix',
      'Wallet of Satoshi',
      'Zeus'
    ])
    expect(lightning.some((h) => h.openTargetName === 'PayPal')).toBe(false)

    const moneroAddr =
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    const moneroWithBolt11 = resolvePaytoPaymentOpenHandlers('monero', moneroAddr, {
      bolt11Invoice: invoice
    })
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'Zeus')).toBe(false)
    expect(moneroWithBolt11.some((h) => h.openTargetName === 'BlueWallet')).toBe(false)

    expect(
      resolvePaytoPaymentOpenHandlers('paypal', 'someuser', { bolt11Invoice: invoice }).map(
        (h) => h.openTargetName
      )
    ).toEqual(['PayPal'])
  })

  it('never mixes fiat web links or lightning wallets across payto types', () => {
    const monero = resolvePaytoPaymentOpenHandlers(
      'monero',
      '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgvYatVKtQNjUoNcknXV85jSp3wjUGpHbWfnqPm4WjwFGtW'
    )
    expect(monero.some((h) => h.openTargetName === 'PayPal')).toBe(false)
    expect(monero.some((h) => h.openTargetName === 'Phoenix')).toBe(false)
    expect(monero.some((h) => h.openTargetName === 'Cake Wallet')).toBe(true)

    const cash = resolvePaytoPaymentOpenHandlers('cashme', '$cashtag')
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
