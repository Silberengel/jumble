import { describe, expect, it } from 'vitest'
import {
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
