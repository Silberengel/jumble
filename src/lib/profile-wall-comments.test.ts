import { ExtendedKind } from '@/constants'
import { describe, expect, it } from 'vitest'
import { isDirectProfileWallComment } from './profile-wall-comments'
import type { Event } from 'nostr-tools'

const PROFILE_ID = 'a'.repeat(64)
const PROFILE_PK = 'b'.repeat(64)

describe('isDirectProfileWallComment', () => {
  it('accepts comment with parent e on profile', () => {
    const event = {
      kind: ExtendedKind.COMMENT,
      id: 'c'.repeat(64),
      tags: [['e', PROFILE_ID, '', 'reply']]
    } as Event
    expect(isDirectProfileWallComment(event, PROFILE_ID, PROFILE_PK)).toBe(true)
  })

  it('rejects nested reply to another comment', () => {
    const event = {
      kind: ExtendedKind.COMMENT,
      id: 'c'.repeat(64),
      tags: [['e', 'd'.repeat(64), '', 'reply']]
    } as Event
    expect(isDirectProfileWallComment(event, PROFILE_ID, PROFILE_PK)).toBe(false)
  })
})
