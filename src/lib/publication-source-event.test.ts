import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { getNoteBech32Id } from '@/lib/event'
import {
  getPublicationSourceEventRefFromIndex,
  resolvePublicationSourceEventBech32,
  truncatePublicationSourceBech32
} from '@/lib/publication-source-event'
import type { Event } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const sk = generateSecretKey()
const PK = getPublicKey(sk)
const SOURCE_ID = '85848121d11cb4134aa9fc41e2a0a5bb27d0f2852ef6d4121c3765cd55e6dfb9'
const AUTHOR_PK = 'c69b71dc564fdc350acddff929f25d7202ac1470c87488608bd6d98e426ba763'

function indexWithETag(tags: string[][]): Event {
  return {
    id: '1'.repeat(64),
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags: [['d', 'book'], ['title', 'Book'], ...tags],
    sig: 'c'.repeat(128)
  }
}

describe('publication-source-event', () => {
  it('encodes hex E tag as nevent with relay and author hints', () => {
    const event = indexWithETag([
      ['E', SOURCE_ID, 'wss://thecitadel.nostr1.com', AUTHOR_PK]
    ])
    const ref = getPublicationSourceEventRefFromIndex(event)
    expect(ref?.eventId).toBe(SOURCE_ID)
    expect(ref?.relay).toBe('wss://thecitadel.nostr1.com')
    expect(ref?.authorPubkey).toBe(AUTHOR_PK)
    expect(ref?.bech32.startsWith('nevent1')).toBe(true)
    const decoded = nip19.decode(ref!.bech32)
    expect(decoded.type).toBe('nevent')
    if (decoded.type === 'nevent') {
      expect(decoded.data.id).toBe(SOURCE_ID)
      expect(decoded.data.author).toBe(AUTHOR_PK)
    }
  })

  it('passes through bech32 naddr on E tag', () => {
    const naddr = nip19.naddrEncode({
      kind: ExtendedKind.PUBLICATION,
      pubkey: AUTHOR_PK,
      identifier: 'original-book'
    })
    const ref = getPublicationSourceEventRefFromIndex(indexWithETag([['E', naddr]]))
    expect(ref?.bech32).toBe(naddr)
  })

  it('upgrades to naddr when fetched source is replaceable', () => {
    const indexRef = getPublicationSourceEventRefFromIndex(
      indexWithETag([['E', SOURCE_ID, 'wss://thecitadel.nostr1.com', AUTHOR_PK]])
    )!
    const sourceIndex = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION,
        created_at: 50,
        content: '',
        tags: [['d', 'original-book'], ['title', 'Original']]
      },
      generateSecretKey()
    )
    expect(resolvePublicationSourceEventBech32(indexRef, sourceIndex).startsWith('naddr1')).toBe(true)
    expect(resolvePublicationSourceEventBech32(indexRef, sourceIndex)).toBe(getNoteBech32Id(sourceIndex))
  })

  it('truncatePublicationSourceBech32 shortens long ids', () => {
    const long = 'nevent1' + 'q'.repeat(50)
    expect(truncatePublicationSourceBech32(long)).toBe(`${long.slice(0, 28)}…`)
    expect(truncatePublicationSourceBech32('nevent1short')).toBe('nevent1short')
  })
})
