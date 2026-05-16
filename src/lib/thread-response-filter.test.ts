import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import {
  isThreadBoosterOnlyRow,
  shouldHideOwnReactionThreadRow,
  shouldHideThreadResponseEvent
} from './thread-response-filter'

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'hello',
    sig: 'd'.repeat(128),
    ...overrides
  }
}

describe('thread response filter', () => {
  it('treats NIP-18 reposts as booster-only rows', () => {
    const repost = baseEvent({
      kind: kinds.Repost,
      tags: [['e', 'c'.repeat(64)]],
      content: ''
    })
    expect(isThreadBoosterOnlyRow(repost)).toBe(true)
    expect(shouldHideThreadResponseEvent(repost, new Set(), false)).toBe(true)
  })

  it('does not treat kind-1 rows as booster-only (only kinds 6 and 16)', () => {
    const target = baseEvent({ content: 'boosted note' })
    expect(isThreadBoosterOnlyRow(baseEvent({ content: JSON.stringify(target) }))).toBe(false)
    expect(
      isThreadBoosterOnlyRow(
        baseEvent({ content: `My take.\n\n${JSON.stringify(target)}` })
      )
    ).toBe(false)
  })

  it('hides generic repost kind 16', () => {
    const repost = baseEvent({
      kind: ExtendedKind.GENERIC_REPOST,
      tags: [['e', 'c'.repeat(64)]]
    })
    expect(isThreadBoosterOnlyRow(repost)).toBe(true)
  })

  it('hides viewer NIP-25 reactions in thread rows (own or others’ notes)', () => {
    const viewer = 'b'.repeat(64)
    const myReaction = baseEvent({
      pubkey: viewer,
      kind: kinds.Reaction,
      content: '+',
      tags: [['e', 'c'.repeat(64), '', 'root']]
    })
    expect(shouldHideOwnReactionThreadRow(myReaction, viewer)).toBe(true)
    expect(shouldHideOwnReactionThreadRow(myReaction, 'a'.repeat(64))).toBe(false)
    expect(
      shouldHideOwnReactionThreadRow(
        baseEvent({ pubkey: 'c'.repeat(64), kind: kinds.Reaction, content: '+' }),
        viewer
      )
    ).toBe(false)
  })
})
