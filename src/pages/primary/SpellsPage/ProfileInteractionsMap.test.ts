import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { mergeInteractionEvents } from './merge-interaction-events'

function interaction(pubkey: string, pTags: string[]) {
  return {
    kind: kinds.ShortTextNote,
    pubkey,
    tags: pTags.map((p) => ['p', p]),
    content: '',
    id: `${pubkey.slice(0, 8)}${'c'.repeat(56)}`,
    sig: 's'.repeat(128),
    created_at: 1_700_000_000
  }
}

describe('mergeInteractionEvents', () => {
  it('excludes muted partners and events authored by muted pubkeys', () => {
    const profile = 'a'.repeat(64)
    const partner = 'b'.repeat(64)
    const muted = 'f'.repeat(64)
    const cards = mergeInteractionEvents(
      profile,
      [
        interaction(profile, [partner]),
        interaction(profile, [muted]),
        interaction(muted, [profile]),
        interaction(partner, [profile])
      ],
      new Set([muted])
    )
    expect(cards.map((c) => c.pubkey)).toEqual([partner])
    expect(cards[0]?.score).toBe(2)
  })
})
