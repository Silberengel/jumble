import { describe, expect, it } from 'vitest'
import { getParentEventHexId, getRootEventHexId } from '@/lib/event'
import {
  collectThreadReplyInboxPubkeys,
  peekThreadRootAuthorPubkey,
  pubkeyFromThreadETag,
  relayHintsFromThreadETag
} from '@/lib/thread-context-relays'

/** Damus-style NIP-10 reply (user report: parent missing on note page). */
const DAMUS_REPLY_TAGS: string[][] = [
  [
    'e',
    '1dae240e0fe68c331cd9f0923f756c148fb7cf0344a7229c7831b676d6102e71',
    'wss://theforest.nostr1.com/',
    'root',
    'b133bfc57bed61c391d4e8f953b906c7f1709c438d91c75fb6daf79449d5789d'
  ],
  [
    'e',
    'c89a8525b4ef8fd3dd149824e6d4f854de8b3120d26286942fd2aabce2d72304',
    'wss://relay.mostr.pub',
    'reply',
    'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
  ]
]

describe('NIP-10 Damus reply thread tags', () => {
  const reply = { kind: 1, tags: DAMUS_REPLY_TAGS } as import('nostr-tools').Event

  it('resolves parent and root hex ids', () => {
    expect(getParentEventHexId(reply)).toBe(
      'c89a8525b4ef8fd3dd149824e6d4f854de8b3120d26286942fd2aabce2d72304'
    )
    expect(getRootEventHexId(reply)).toBe(
      '1dae240e0fe68c331cd9f0923f756c148fb7cf0344a7229c7831b676d6102e71'
    )
  })

  it('reads relay hint and parent author from reply e tag', () => {
    const parentTag = DAMUS_REPLY_TAGS[1]
    expect(relayHintsFromThreadETag(parentTag)).toEqual(['wss://relay.mostr.pub/'])
    expect(pubkeyFromThreadETag(parentTag)).toBe(
      'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
    )
  })

  it('collectThreadReplyInboxPubkeys includes thread OP when replying under a nested note', () => {
    const reply = {
      kind: 1,
      pubkey: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      tags: DAMUS_REPLY_TAGS
    } as import('nostr-tools').Event
    expect(collectThreadReplyInboxPubkeys(reply)).toEqual([
      'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      'b133bfc57bed61c391d4e8f953b906c7f1709c438d91c75fb6daf79449d5789d'
    ])
    expect(peekThreadRootAuthorPubkey(reply)).toBe(
      'b133bfc57bed61c391d4e8f953b906c7f1709c438d91c75fb6daf79449d5789d'
    )
  })
})
