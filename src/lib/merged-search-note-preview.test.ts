import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { mergedSearchNoteHasPreviewBody } from './merged-search-note-preview'

describe('mergedSearchNoteHasPreviewBody', () => {
  it('treats hashtag-only kind 1 notes as visible', () => {
    const ev = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_000,
      kind: kinds.ShortTextNote,
      tags: [['t', 'Palantir']],
      content: '',
      sig: 'sig'
    }
    expect(mergedSearchNoteHasPreviewBody(ev)).toBe(true)
  })
})
