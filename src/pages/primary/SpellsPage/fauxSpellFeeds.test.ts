import { FAST_WRITE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  buildCalendarReadRelayUrls,
  buildDiscussionsSpellRelayUrls,
  buildNotificationSpellRelayUrls,
  mergeDiscussionFastWriteReadRelays,
  CALENDAR_READ_MAX_RELAYS,
  FAUX_SPELL_MAX_RELAYS,
  notificationMentionIndexRelayUrls
} from './fauxSpellFeeds'
import { nip52UtcDayIndicesForLocalRange } from '@/lib/calendar-event'

describe('buildNotificationSpellRelayUrls', () => {
  it('pins mention index relays even when personal inbox fills the cap', () => {
    const personal = Array.from({ length: 12 }, (_, i) => `wss://personal-inbox-${i}.example/`)
    const out = buildNotificationSpellRelayUrls(personal)
    expect(out.length).toBeLessThanOrEqual(FAUX_SPELL_MAX_RELAYS)
    const mentionKeys = new Set(
      notificationMentionIndexRelayUrls().map((u) => u.replace(/\/$/, '').toLowerCase())
    )
    const pinned = out.filter((u) => mentionKeys.has(u.replace(/\/$/, '').toLowerCase()))
    expect(pinned.length).toBeGreaterThanOrEqual(3)
  })

  it('returns mention index relays when personal stack is empty', () => {
    const out = buildNotificationSpellRelayUrls([])
    expect(out.length).toBeGreaterThan(0)
    expect(out.some((u) => u.includes('theforest.nostr1.com') || u.includes('nostr.land'))).toBe(true)
    expect(out.some((u) => u.includes('nosmero.com'))).toBe(true)
  })
})

describe('buildDiscussionsSpellRelayUrls', () => {
  it('includes FAST_WRITE relays and at least two FAST_READ relays when personal stack is empty', () => {
    const out = buildDiscussionsSpellRelayUrls([])
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(FAUX_SPELL_MAX_RELAYS)
    const norm = (u: string) => u.replace(/\/$/, '').toLowerCase()
    const outNorm = new Set(out.map(norm))
    const writeHit = FAST_WRITE_RELAY_URLS.some((w) => outNorm.has(norm(w)))
    expect(writeHit).toBe(true)
    const fastReadCount = out.filter(
      (u) => u.includes('theforest.nostr1.com') || u.includes('nostr.land') || u.includes('nostr.wine')
    ).length
    expect(fastReadCount).toBeGreaterThanOrEqual(2)
  })

  it('drops blocked relays from the write tier', () => {
    const blocked = ['wss://nos.lol/']
    const out = buildDiscussionsSpellRelayUrls([], blocked)
    expect(out.some((u) => u.includes('nos.lol'))).toBe(false)
  })
})

describe('mergeDiscussionFastWriteReadRelays', () => {
  it('appends FAST_WRITE relays not already in the stack', () => {
    const base = ['wss://theforest.nostr1.com/']
    const out = mergeDiscussionFastWriteReadRelays(base)
    expect(out[0]).toContain('theforest.nostr1.com')
    expect(out.some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true)
    expect(out.some((u) => u.includes('nos.lol'))).toBe(true)
  })

  it('respects blocked relays', () => {
    const out = mergeDiscussionFastWriteReadRelays([], ['wss://relay.primal.net'])
    expect(out.some((u) => u.includes('primal.net'))).toBe(false)
    expect(out.some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true)
  })
})

describe('buildCalendarReadRelayUrls', () => {
  it('pins at least two FAST_READ relays when personal stack is empty', () => {
    const out = buildCalendarReadRelayUrls([], [], [], [], { includeReadOnlyMirrors: false })
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(CALENDAR_READ_MAX_RELAYS)
    const fastReadCount = out.filter(
      (u) => u.includes('theforest.nostr1.com') || u.includes('nostr.land') || u.includes('nostr.wine')
    ).length
    expect(fastReadCount).toBeGreaterThanOrEqual(2)
  })
})

describe('nip52UtcDayIndicesForLocalRange', () => {
  it('returns consecutive UTC day indices for a week', () => {
    const start = new Date(2026, 5, 16, 0, 0, 0, 0).getTime()
    const end = start + 7 * 86_400_000
    const indices = nip52UtcDayIndicesForLocalRange(start, end, 0)
    expect(indices.length).toBeGreaterThanOrEqual(7)
    expect(indices.length).toBeLessThanOrEqual(9)
  })
})
