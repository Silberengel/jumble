import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildAttestedPaymentIdSet,
  collectAttestedSuperchatsFromRepliesMap,
  isValidPaymentAttestation,
  filterAttestedProfileWallSuperchats,
  getPaymentNotificationInfo,
  getSuperchatPaytoType,
  getSuperchatReferenceFetchId,
  canUserAttestSuperchatPayment,
  isIncomingNotificationsPaymentEvent,
  isProfileWallPaymentNotification,
  isProfileWallZapReceipt,
  isNestedThreadReplyParentKind,
  buildGlobalAttestedSuperchatIdSet,
  partitionAttestedSuperchats,
  shouldIncludePaymentInFeed
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

describe('canUserAttestSuperchatPayment', () => {
  it('accepts payment notification recipient via p tag', () => {
    const event = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [['p', RECIPIENT], ['amount', '1000']]
    })
    expect(canUserAttestSuperchatPayment(event, RECIPIENT)).toBe(true)
  })

  it('accepts zap receipt recipient via p tag when bolt11 metadata is missing', () => {
    const event = fakeEvent({
      id: ZAP_ID,
      kind: ExtendedKind.ZAP_RECEIPT,
      tags: [['p', RECIPIENT], ['e', 'f'.repeat(64)]]
    })
    expect(canUserAttestSuperchatPayment(event, RECIPIENT)).toBe(true)
  })

  it('accepts note author override for note zaps', () => {
    const noteAuthor = RECIPIENT
    const payer = SENDER
    const event = fakeEvent({
      id: ZAP_ID,
      kind: ExtendedKind.ZAP_RECEIPT,
      pubkey: payer,
      tags: [['p', payer], ['e', 'f'.repeat(64)]]
    })
    expect(canUserAttestSuperchatPayment(event, noteAuthor, noteAuthor)).toBe(true)
    expect(canUserAttestSuperchatPayment(event, payer)).toBe(true)
    expect(canUserAttestSuperchatPayment(event, 'c'.repeat(64))).toBe(false)
  })
})

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

  it('collects attested ids without a k tag', () => {
    const attestation = fakeEvent({
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [['e', PAYMENT_ID]]
    })
    expect(buildAttestedPaymentIdSet([attestation], RECIPIENT).has(PAYMENT_ID)).toBe(true)
  })

  it('ignores attestations with an invalid k tag', () => {
    const attestation = fakeEvent({
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [
        ['e', PAYMENT_ID],
        ['k', '1']
      ]
    })
    expect(isValidPaymentAttestation(attestation, RECIPIENT)).toBe(false)
    expect(buildAttestedPaymentIdSet([attestation], RECIPIENT).size).toBe(0)
  })
})

describe('collectAttestedSuperchatsFromRepliesMap', () => {
  it('returns attested superchats not already in the BFS set', () => {
    const payment = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [['p', RECIPIENT], ['e', '2'.repeat(64)]]
    })
    const repliesMap = new Map([
      ['2'.repeat(64), { events: [payment], eventIdSet: new Set([PAYMENT_ID]) }]
    ])
    const found = collectAttestedSuperchatsFromRepliesMap(
      repliesMap,
      new Set([PAYMENT_ID]),
      new Set<string>(),
      () => true
    )
    expect(found.map((e) => e.id)).toEqual([PAYMENT_ID])
  })
})

describe('isNestedThreadReplyParentKind', () => {
  it('includes zaps and payment notifications for nested thread fetch', () => {
    expect(isNestedThreadReplyParentKind(kinds.Zap)).toBe(true)
    expect(isNestedThreadReplyParentKind(ExtendedKind.ZAP_RECEIPT)).toBe(true)
    expect(isNestedThreadReplyParentKind(ExtendedKind.PAYMENT_NOTIFICATION)).toBe(true)
    expect(isNestedThreadReplyParentKind(kinds.ShortTextNote)).toBe(true)
    expect(isNestedThreadReplyParentKind(kinds.Reaction)).toBe(false)
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
      attested
    )

    expect(superchats.map((e) => e.id)).toEqual([payment.id, zapAttested.id])
    expect(rest).toEqual([comment])
  })

  it('includes attested micro zaps in threads (feed threshold does not apply)', () => {
    const attested = new Set([ZAP_ID])
    const microZap = fakeEvent({
      id: ZAP_ID,
      kind: kinds.Zap,
      tags: [
        ['P', SENDER],
        ['p', RECIPIENT],
        ['bolt11', 'lnbc1n1p0fake'],
        [
          'description',
          JSON.stringify({
            pubkey: SENDER,
            content: 'tiny',
            tags: [['p', RECIPIENT], ['amount', '1000']]
          })
        ]
      ]
    })
    const comment = fakeEvent({
      id: '1'.repeat(64),
      kind: ExtendedKind.COMMENT,
      tags: [['e', '2'.repeat(64)]]
    })
    const { superchats, rest } = partitionAttestedSuperchats([microZap, comment], attested)
    expect(superchats.map((e) => e.id)).toEqual([ZAP_ID])
    expect(rest).toEqual([comment])
  })
})

describe('buildGlobalAttestedSuperchatIdSet', () => {
  it('collects attested target ids from valid kind 9741 events', () => {
    const paymentId = PAYMENT_ID
    const attestation = fakeEvent({
      id: 'a'.repeat(64),
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [
        ['e', paymentId],
        ['k', String(ExtendedKind.PAYMENT_NOTIFICATION)]
      ]
    })
    expect(buildGlobalAttestedSuperchatIdSet([attestation]).has(paymentId)).toBe(true)
  })
})

describe('shouldIncludePaymentInFeed', () => {
  it('requires attestation for superchat kinds only', () => {
    const zap = fakeEvent({
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
    const payment = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [['p', RECIPIENT], ['amount', '100000']]
    })
    const note = fakeEvent({ id: '1'.repeat(64), kind: kinds.ShortTextNote, content: 'hi', tags: [] })
    const attested = new Set([ZAP_ID, PAYMENT_ID])

    expect(shouldIncludePaymentInFeed(zap, attested)).toBe(true)
    expect(shouldIncludePaymentInFeed(payment, attested)).toBe(true)
    expect(shouldIncludePaymentInFeed(zap, new Set())).toBe(false)
    expect(shouldIncludePaymentInFeed(note, attested)).toBe(true)
  })

  it('includes unattested incoming payments for the notifications recipient only', () => {
    const zap = fakeEvent({
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
    const payment = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [['p', RECIPIENT], ['amount', '100000']]
    })
    const moneroDisclosure = fakeEvent({
      id: 'a'.repeat(64),
      kind: ExtendedKind.MONERO_TIP_DISCLOSURE,
      tags: [['p', RECIPIENT], ['amount', '0.01']]
    })
    const moneroReceipt = fakeEvent({
      id: 'b'.repeat(64),
      kind: ExtendedKind.MONERO_TIP_RECEIPT,
      tags: [['p', SENDER], ['p', RECIPIENT]],
      content: JSON.stringify({ txid: 'abc', message: 'tip' })
    })
    const zapRequest = fakeEvent({
      id: 'c'.repeat(64),
      kind: ExtendedKind.ZAP_REQUEST,
      pubkey: SENDER,
      tags: [['p', RECIPIENT], ['amount', '21000']]
    })
    const empty = new Set<string>()

    expect(shouldIncludePaymentInFeed(zap, empty, RECIPIENT)).toBe(true)
    expect(shouldIncludePaymentInFeed(payment, empty, RECIPIENT)).toBe(true)
    expect(shouldIncludePaymentInFeed(moneroDisclosure, empty, RECIPIENT)).toBe(true)
    expect(shouldIncludePaymentInFeed(moneroReceipt, empty, RECIPIENT)).toBe(true)
    expect(shouldIncludePaymentInFeed(zapRequest, empty, RECIPIENT)).toBe(true)
    expect(shouldIncludePaymentInFeed(zap, empty, SENDER)).toBe(false)
    expect(shouldIncludePaymentInFeed(zap, empty)).toBe(false)
  })
})

describe('isIncomingNotificationsPaymentEvent', () => {
  it('matches all payment kinds addressed to the recipient', () => {
    expect(
      isIncomingNotificationsPaymentEvent(
        fakeEvent({
          kind: ExtendedKind.ZAP_REQUEST,
          tags: [['p', RECIPIENT], ['amount', '21000']]
        }),
        RECIPIENT
      )
    ).toBe(true)
    expect(
      isIncomingNotificationsPaymentEvent(
        fakeEvent({
          kind: ExtendedKind.MONERO_TIP_DISCLOSURE,
          tags: [['p', RECIPIENT], ['amount', '0.01']]
        }),
        RECIPIENT
      )
    ).toBe(true)
    expect(
      isIncomingNotificationsPaymentEvent(
        fakeEvent({
          kind: ExtendedKind.MONERO_TIP_RECEIPT,
          tags: [['p', SENDER], ['p', RECIPIENT]],
          content: '{}'
        }),
        RECIPIENT
      )
    ).toBe(true)
    expect(
      isIncomingNotificationsPaymentEvent(
        fakeEvent({ kind: kinds.ShortTextNote, tags: [['p', RECIPIENT]] }),
        RECIPIENT
      )
    ).toBe(false)
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

  it('rejects 9740 with a thread reference on the profile wall', () => {
    const evt = fakeEvent({
      id: PAYMENT_ID,
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      tags: [
        ['p', RECIPIENT],
        ['e', 'f'.repeat(64)],
        ['amount', '50000']
      ]
    })
    const attestation = fakeEvent({
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [
        ['e', PAYMENT_ID],
        ['k', '9740']
      ]
    })
    expect(isProfileWallPaymentNotification(evt, RECIPIENT)).toBe(false)
    const out = filterAttestedProfileWallSuperchats([evt], [attestation], RECIPIENT)
    expect(out).toHaveLength(0)
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

  it('accepts profile-only zap receipt without thread reference', () => {
    const evt = fakeEvent({
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
    expect(isProfileWallZapReceipt(evt, RECIPIENT)).toBe(true)
  })

  it('filters to attested profile wall zap receipts', () => {
    const zap = fakeEvent({
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
            content: 'Wall zap',
            tags: [['p', RECIPIENT], ['amount', '21000']]
          })
        ]
      ]
    })
    const attestation = fakeEvent({
      kind: ExtendedKind.PAYMENT_ATTESTATION,
      pubkey: RECIPIENT,
      tags: [
        ['e', ZAP_ID],
        ['k', '9735']
      ]
    })
    const out = filterAttestedProfileWallSuperchats([zap], [attestation], RECIPIENT)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe(ZAP_ID)
  })
})
