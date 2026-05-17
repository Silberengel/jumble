import { describe, expect, it } from 'vitest'
import { kinds, nip19 } from 'nostr-tools'
import {
  COMPANION_PUBLISH_CAP,
  collectCompanionRefsInPublishOrder
} from './companion-publish'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)
const HEX_C = 'c'.repeat(64)
const HEX_D = 'd'.repeat(64)
const HEX_PUB = 'e'.repeat(64)

describe('collectCompanionRefsInPublishOrder', () => {
  it('orders embedded before q before a before e', () => {
    const note1 = nip19.noteEncode(HEX_B)
    const ev = {
      id: HEX_A,
      kind: kinds.ShortTextNote,
      content: `see nostr:${note1}`,
      tags: [
        ['q', HEX_B],
        ['a', `30023:${HEX_PUB}:doc`, HEX_C],
        ['e', HEX_D]
      ],
      pubkey: HEX_PUB,
      created_at: 1,
      sig: 's'.repeat(128)
    }

    const refs = collectCompanionRefsInPublishOrder(ev as never)
    const tiers = refs.map((r) => r.tier)
    const firstEmbedded = tiers.indexOf('embedded')
    const firstQ = tiers.indexOf('q')
    const firstA = tiers.indexOf('a')
    const firstE = tiers.indexOf('e')

    expect(firstEmbedded).toBeGreaterThanOrEqual(0)
    expect(firstQ).toBeGreaterThan(firstEmbedded)
    expect(firstA).toBeGreaterThan(firstQ)
    expect(firstE).toBeGreaterThan(firstA)
  })
})

describe('COMPANION_PUBLISH_CAP', () => {
  it('is 5', () => {
    expect(COMPANION_PUBLISH_CAP).toBe(5)
  })
})
