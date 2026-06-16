import { FAST_WRITE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  buildDiscussionsSpellRelayUrls,
  buildNotificationSpellRelayUrls,
  FAUX_SPELL_MAX_RELAYS,
  notificationMentionIndexRelayUrls
} from './fauxSpellFeeds'

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
