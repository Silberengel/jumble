import { ExtendedKind } from '@/constants'
import { createBooklistLabelDraftEvent } from '@/lib/draft-event'
import {
  booklistLabelTargetsPublication,
  findSessionBooklistLabelForPublication
} from '@/lib/booklist-label'
import { NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from '@/lib/nip32-label'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function publicationEvent(d = 'jane-eyre'): Event {
  return {
    id: '1'.repeat(64),
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags: [['d', d], ['title', 'Jane Eyre'], ['a', `30041:${PK}:intro`]],
    sig: 'c'.repeat(128)
  }
}

describe('booklist-label', () => {
  it('createBooklistLabelDraftEvent uses ugc namespace and booklist l tag', () => {
    const publication = publicationEvent()
    const draft = createBooklistLabelDraftEvent(publication)
    expect(draft.kind).toBe(ExtendedKind.LABEL)
    expect(draft.tags).toContainEqual(['L', NIP32_UGC_NAMESPACE])
    expect(draft.tags).toContainEqual(['l', NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE])
    expect(draft.tags.some((t) => t[0] === 'a' && t[1] === `30040:${PK}:jane-eyre`)).toBe(true)
  })

  it('booklistLabelTargetsPublication matches a-tag address', () => {
    const publication = publicationEvent()
    const label: Event = {
      id: '2'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [
        ['L', 'ugc'],
        ['l', 'booklist', 'ugc'],
        ['a', `30040:${PK}:jane-eyre`]
      ],
      sig: 'e'.repeat(128)
    }
    expect(booklistLabelTargetsPublication(label, publication)).toBe(true)
  })

  it('findSessionBooklistLabelForPublication reads session-authored labels', () => {
    const publication = publicationEvent()
    const label: Event = {
      id: '3'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [
        ['L', 'ugc'],
        ['l', 'booklist', 'ugc'],
        ['a', `30040:${PK}:jane-eyre`]
      ],
      sig: 'e'.repeat(128)
    }
    // eventService session is empty in unit tests; just verify non-match
    expect(findSessionBooklistLabelForPublication('f'.repeat(64), publication)).toBeNull()
    expect(booklistLabelTargetsPublication(label, publication)).toBe(true)
  })
})
