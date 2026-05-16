import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'
import {
  isLongFormNip71VideoEventKind,
  shouldDeferLongVideoAutoload
} from './long-video-load-policy'

function fakeEvent(kind: number): Event {
  return { kind, id: 'ab'.repeat(32), pubkey: 'cd'.repeat(32), created_at: 0, tags: [], content: '' }
}

describe('long-video-load-policy', () => {
  it('treats kind 21 and 34235 as long-form', () => {
    expect(isLongFormNip71VideoEventKind(ExtendedKind.VIDEO)).toBe(true)
    expect(isLongFormNip71VideoEventKind(ExtendedKind.VIDEO_ADDRESSABLE)).toBe(true)
    expect(isLongFormNip71VideoEventKind(ExtendedKind.SHORT_VIDEO)).toBe(false)
  })

  it('defers autoload for long-form events unless forced', () => {
    expect(shouldDeferLongVideoAutoload(fakeEvent(ExtendedKind.VIDEO))).toBe(true)
    expect(
      shouldDeferLongVideoAutoload(fakeEvent(ExtendedKind.VIDEO), { forceLoadMedia: true })
    ).toBe(false)
    expect(shouldDeferLongVideoAutoload(fakeEvent(ExtendedKind.SHORT_VIDEO))).toBe(false)
  })
})
