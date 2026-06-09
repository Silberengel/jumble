import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  formatXmrAmount,
  formatPiconeroLineAmount,
  getMoneroTipInfo,
  getMoneroTipSortAmount,
  isMoneroTipKind,
  xmrToPiconeros
} from './monero-tip'

describe('monero-tip', () => {
  it('recognizes monero tip kinds', () => {
    expect(isMoneroTipKind(ExtendedKind.MONERO_TIP_DISCLOSURE)).toBe(true)
    expect(isMoneroTipKind(ExtendedKind.MONERO_TIP_RECEIPT)).toBe(true)
    expect(isMoneroTipKind(1)).toBe(false)
  })

  it('parses Nosmero kind 9736', () => {
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: ExtendedKind.MONERO_TIP_DISCLOSURE,
      tags: [
        ['e', 'c'.repeat(64)],
        ['p', 'd'.repeat(64)],
        ['P', 'b'.repeat(64)],
        ['amount', '0.5'],
        ['txid', 'e'.repeat(64)],
        ['verified', 'true']
      ],
      content: 'thanks',
      sig: 'f'.repeat(128)
    }
    const info = getMoneroTipInfo(event)
    expect(info?.amountXmr).toBe(0.5)
    expect(info?.verified).toBe(true)
    expect(info?.comment).toBe('thanks')
    expect(info?.recipientPubkey).toBe('d'.repeat(64))
  })

  it('parses Garnet kind 1814 JSON content', () => {
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: ExtendedKind.MONERO_TIP_RECEIPT,
      tags: [['e', 'c'.repeat(64)], ['p', 'd'.repeat(64)]],
      content: JSON.stringify({
        txid: 'e'.repeat(64),
        proofs: { proof1: ['4addr'] },
        message: 'hello'
      }),
      sig: 'f'.repeat(128)
    }
    const info = getMoneroTipInfo(event)
    expect(info?.comment).toBe('hello')
    expect(info?.txid).toBe('e'.repeat(64))
    expect(getMoneroTipSortAmount(event)).toBe(0)
  })

  it('formats XMR amounts', () => {
    expect(formatXmrAmount(0.5)).toContain('0.5')
    expect(formatXmrAmount(2)).toContain('2')
  })

  it('converts XMR to piconeros and formats compact lines', () => {
    expect(xmrToPiconeros(0.5)).toBe(500_000_000_000)
    expect(formatPiconeroLineAmount(420)).toBe('420')
    expect(formatPiconeroLineAmount(1_500_000_000)).toBe('1.5M')
  })
})
