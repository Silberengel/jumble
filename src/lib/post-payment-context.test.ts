import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'
import {
  mergePostPaymentContext,
  paymentNotificationReferenceTags
} from './post-payment-context'

const AUTHOR = 'a'.repeat(64)
const RECIPIENT = 'b'.repeat(64)
const EVENT_ID = 'c'.repeat(64)

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: partial.id ?? EVENT_ID,
    pubkey: partial.pubkey ?? AUTHOR,
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind,
    tags: partial.tags,
    content: partial.content ?? '',
    sig: partial.sig ?? ''
  }
}

describe('paymentNotificationReferenceTags', () => {
  it('returns e, P, and k for regular notes', () => {
    const note = fakeEvent({ kind: kinds.ShortTextNote, tags: [] })
    const tags = paymentNotificationReferenceTags(note)
    expect(tags.some((t) => t[0] === 'e' && t[1] === EVENT_ID && t[3] === AUTHOR)).toBe(true)
    expect(tags).toContainEqual(['P', AUTHOR])
    expect(tags).toContainEqual(['k', String(kinds.ShortTextNote)])
  })

  it('returns a, P, and k for replaceable events', () => {
    const article = fakeEvent({
      kind: kinds.LongFormArticle,
      tags: [['d', 'my-article']]
    })
    const tags = paymentNotificationReferenceTags(article)
    expect(tags.some((t) => t[0] === 'a' && t[1]?.includes(AUTHOR))).toBe(true)
    expect(tags).toContainEqual(['P', AUTHOR])
    expect(tags).toContainEqual(['k', String(kinds.LongFormArticle)])
  })

  it('returns no tags when reference is omitted (profile wall default)', () => {
    expect(paymentNotificationReferenceTags(undefined)).toEqual([])
  })
})

describe('mergePostPaymentContext', () => {
  it('keeps note reference from base when partial omits it', () => {
    const note = fakeEvent({ kind: kinds.ShortTextNote, tags: [] })
    const ctx = mergePostPaymentContext(
      { recipientPubkey: RECIPIENT, referencedEvent: note },
      { amountMsat: 21_000 }
    )
    expect(ctx.referencedEvent).toBe(note)
    expect(ctx.amountMsat).toBe(21_000)
  })

  it('omits reference for profile tips', () => {
    const ctx = mergePostPaymentContext({ recipientPubkey: RECIPIENT }, { payto: 'monero/addr' })
    expect(ctx.referencedEvent).toBeUndefined()
    expect(ctx.payto).toBe('monero/addr')
  })
})
