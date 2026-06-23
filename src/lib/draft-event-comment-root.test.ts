import { ExtendedKind } from '@/constants'
import { createCommentDraftEvent } from '@/lib/draft-event'
import client from '@/services/client.service'
import { kinds, type Event } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function note(overrides: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: 'c'.repeat(64),
    pubkey: 'd'.repeat(64),
    created_at: 1,
    sig: 'sig',
    content: 'parent',
    ...overrides
  } as Event
}

describe('createCommentDraftEvent thread root enrichment', () => {
  beforeEach(() => {
    vi.spyOn(client, 'peekSessionCachedEvent').mockReturnValue(undefined)
    vi.spyOn(client, 'getEventHint').mockReturnValue('')
  })

  it('adds E/P/K for thread OP when replying to kind 1 nested reply', async () => {
    const rootId = '1dae240e0fe68c331cd9f0923f756c148fb7cf0344a7229c7831b676d6102e71'
    const opPubkey = 'b133bfc57bed61c391d4e8f953b906c7f1709c438d91c75fb6daf79449d5789d'
    const parent = note({
      id: 'c89a8525b4ef8fd3dd149824e6d4f854de8b3120d26286942fd2aabce2d72304',
      pubkey: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      kind: kinds.ShortTextNote,
      tags: [
        ['e', rootId, '', 'root', opPubkey],
        [
          'e',
          'c89a8525b4ef8fd3dd149824e6d4f854de8b3120d26286942fd2aabce2d72304',
          '',
          'reply',
          'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
        ]
      ]
    })

    const draft = await createCommentDraftEvent('nested reply', parent, [])
    expect(draft.tags.find((t) => t[0] === 'E' && t[1] === rootId)).toBeTruthy()
    expect(draft.tags.find((t) => t[0] === 'P' && t[1] === opPubkey)).toBeTruthy()
    expect(draft.tags.find((t) => t[0] === 'K' && t[1] === String(kinds.ShortTextNote))).toBeTruthy()
  })

  it('fills missing P from session cache when parent kind 1111 has E but no P', async () => {
    const rootId = '1dae240e0fe68c331cd9f0923f756c148fb7cf0344a7229c7831b676d6102e71'
    const opPubkey = 'b133bfc57bed61c391d4e8f953b906c7f1709c438d91c75fb6daf79449d5789d'
    vi.spyOn(client, 'peekSessionCachedEvent').mockImplementation((id: string) => {
      if (id.toLowerCase() === rootId) {
        return note({
          id: rootId,
          pubkey: opPubkey,
          kind: kinds.ShortTextNote,
          tags: []
        })
      }
      return undefined
    })

    const parent = note({
      kind: ExtendedKind.COMMENT,
      tags: [
        ['E', rootId],
        ['K', String(kinds.ShortTextNote)],
        ['e', 'c'.repeat(64)],
        ['k', String(ExtendedKind.COMMENT)],
        ['p', 'd'.repeat(64)]
      ]
    })

    const draft = await createCommentDraftEvent('comment reply', parent, [])
    expect(draft.tags.find((t) => t[0] === 'P' && t[1] === opPubkey)).toBeTruthy()
    expect(draft.tags.find((t) => t[0] === 'E' && t[1] === rootId)).toBeTruthy()
  })
})
