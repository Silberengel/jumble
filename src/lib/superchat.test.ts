import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildAttestedPaymentIdSet,
  filterAttestedProfileWallSuperchats,
  getPaymentNotificationInfo,
  getSuperchatPaytoType,
  getSuperchatReferenceFetchId,
  isProfileWallPaymentNotification,
  partitionAttestedSuperchats
} from '@/lib/superchat'
import { parsePaytoTagType } from '@/lib/payto'
import { kinds, type Event } from 'nostr-tools'

const RECIPIENT = 'a'.repeat(64)
const SENDER = 'b'.repeat(64)
const ZAP_ID = 'c'.repeat(64)
const PAYMENT_ID = 'd'.repeat(64)

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: partial.id ?? 'e'.repeat(64),
    pubkey: partial.pubkey ?? SENDER,
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind,
    tags: partial.tags,
    content: partial.content ?? '',
    sig: partial.sig ?? ''
  }
}

describe('buildAttestedPaymentIdSet', () => {
  it('collects attested zap and payment notification ids from recipient', () => {
    const attestations = [
      fakeEvent({
        kind: ExtendedKind.PAYMENT_ATTESTATION,
        pubkey: RECIPIENT,
        tags: [
          ['e', ZAP_ID],
          ['k', '9735']
        ]
      }),
      fakeEvent({
        kind: ExtendedKind.PAYMENT_ATTESTATION,
        pubkey: RECIPIENT,
        tags: [
          ['e', PAYMENT_ID],
          ['k', '9740']
        ]
      }),
      fakeEvent({
        kind: ExtendedKind.PAYMENT_ATTESTATION,
        pubkey: SENDER,
        tags: [
          ['e', ZAP_ID],
          ['k', '9735']
        ]
      })
    ]
    const ids = buildAttestedPaymentIdSet(attestations, RECIPIENT)
    expect(ids.has(ZAP_ID)).toBe(true)
    expect(ids.has(PAYMENT_ID)).toBe(true)
    expect(ids.size).toBe(2)
  })
})

describe('partitionAttestedSuperchats', () => {
  it('drops unattested zaps and keeps attested zaps and payment notifications', () => {
    const attested = new Set([ZAP_ID, PAYMENT_ID])
    const zapAttested = fakeEvent({
      id: ZAP_ID,
      kind: kinds.Zap,
      tags: [
        ['P', SENDER],
        ['p', RECIPIENT],
        ['bolt11', 'lnbc210n1p0fake'],
        [
          'description',
          JSON.stringify({
            pubkey: SENDER,
            content: 'Zap!',
            tags: [['p', RECIPIENT], ['amount', '21000']]
          })
        ]
      ]
    })
    const zapUnattested = fakeEvent({
      id: 'f'.repeat(64),
      kind: kinds.Zap,
      tags: [
        ['P', SENDER],
        ['p', RECIPIENT],
        ['amount', '42000'],
        ['bolt11', 'lnbc2']
      ]
    })
    const payment = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      content: 'Thanks!',
      tags: [
        ['p', RECIPIENT],
        ['amount', '100000']
      ]
    })
    const comment = fakeEvent({
      id: '1'.repeat(64),
      kind: ExtendedKind.COMMENT,
      tags: [['e', '2'.repeat(64)]]
    })

    const { superchats, rest } = partitionAttestedSuperchats(
      [zapAttested, zapUnattested, payment, comment],
      attested,
      1
    )

    expect(superchats.map((e) => e.id)).toEqual([payment.id, zapAttested.id])
    expect(rest).toEqual([comment])
  })
})

describe('getPaymentNotificationInfo', () => {
  it('uses only the first p, e, and a tags', () => {
    const evt = fakeEvent({
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [
        ['p', RECIPIENT],
        ['p', SENDER],
        ['e', '1'.repeat(64)],
        ['e', '2'.repeat(64)],
        ['a', '30023:' + RECIPIENT + ':'],
        ['a', '30023:' + SENDER + ':'],
        ['payto', 'monero/primary'],
        ['payto', 'lightning/user'],
        ['amount', '100000'],
        ['amount', '200000']
      ]
    })
    const info = getPaymentNotificationInfo(evt)
    expect(info?.recipientPubkey).toBe(RECIPIENT)
    expect(info?.referencedEventId).toBe('1'.repeat(64))
    expect(info?.referencedCoordinate).toBe('30023:' + RECIPIENT + ':')
    expect(info?.payto).toBe('monero/primary')
    expect(info?.amountSats).toBe(100)
  })
})

describe('getSuperchatPaytoType', () => {
  it('returns lightning for zap receipts', () => {
    const zap = fakeEvent({ kind: kinds.Zap, tags: [['p', RECIPIENT]] })
    expect(getSuperchatPaytoType(zap)).toBe('lightning')
  })

  it('parses payto type from payment notification', () => {
    const evt = fakeEvent({
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [
        ['p', RECIPIENT],
        ['payto', 'geyser/project123']
      ]
    })
    expect(getSuperchatPaytoType(evt)).toBe('geyser')
    expect(parsePaytoTagType('lightning/user%40example.com')).toBe('lightning')
  })
})

describe('getSuperchatReferenceFetchId', () => {
  it('prefers event id over coordinate', () => {
    const info = {
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountSats: 0,
      referencedEventId: '1'.repeat(64),
      referencedCoordinate: `30023:${RECIPIENT}:article`
    }
    expect(getSuperchatReferenceFetchId(info)).toBe('1'.repeat(64))
  })

  it('returns naddr for replaceable coordinate when no e tag', () => {
    const info = {
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountSats: 0,
      referencedCoordinate: `30023:${RECIPIENT}:my-article`
    }
    const id = getSuperchatReferenceFetchId(info)
    expect(id).toBeTruthy()
    expect(id).toMatch(/^naddr1/)
  })
})

describe('profile wall payment notifications', () => {
  it('accepts profile-only 9740 without thread reference', () => {
    const evt = fakeEvent({
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [
        ['p', RECIPIENT],
        ['amount', '50000']
      ]
    })
    expect(isProfileWallPaymentNotification(evt, RECIPIENT)).toBe(true)
    expect(getPaymentNotificationInfo(evt)?.amountSats).toBe(50)
  })

  it('filters to attested profile wall superchats', () => {
    const paymentId = PAYMENT_ID
    const payment = fakeEvent({
      id: paymentId,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      content: 'Wall tip',
      tags: [
        ['p', RECIPIENT],
        ['amount', '21000']
      ]
    })
    const attestation = fakeEvent({
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [
        ['e', paymentId],
        ['k', '9740']
      ]
    })
    const out = filterAttestedProfileWallSuperchats([payment], [attestation], RECIPIENT)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe(paymentId)
  })
})
