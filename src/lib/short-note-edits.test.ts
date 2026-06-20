import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildShortNoteEditState,
  getReplyShortNoteEditId,
  getShortNoteEditTargetId,
  isAuthorShortNoteEdit,
  mergeEditedShortNote,
  pickLatestAuthorShortNoteEdit
} from '@/lib/short-note-edits'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

const kind1Author = 'aa'.repeat(32)
const otherPubkey = 'bb'.repeat(32)
const noteId = 'cc'.repeat(32)

function editEvent(
  id: string,
  pubkey: string,
  content: string,
  created_at: number,
  extraTags: string[][] = []
): Event {
  return {
    id,
    pubkey,
    kind: ExtendedKind.SHORT_NOTE_EDIT,
    content,
    created_at,
    tags: [['e', noteId], ...extraTags],
    sig: 'sig'
  }
}

const kind1: Event = {
  id: noteId,
  pubkey: kind1Author,
  kind: kinds.ShortTextNote,
  content: 'original',
  created_at: 100,
  tags: [],
  sig: 'sig'
}

describe('short-note-edits', () => {
  it('reads edit target from kind 1010', () => {
    const edit = editEvent('dd'.repeat(32), kind1Author, 'v2', 200)
    expect(getShortNoteEditTargetId(edit)).toBe(noteId)
  })

  it('picks latest author edit by created_at', () => {
    const e1 = editEvent('11'.repeat(32), kind1Author, 'v1', 200)
    const e2 = editEvent('22'.repeat(32), kind1Author, 'v2', 300)
    expect(pickLatestAuthorShortNoteEdit([e1, e2], kind1)?.content).toBe('v2')
  })

  it('ignores kind 1010 events not signed by the note author', () => {
    const author = editEvent('11'.repeat(32), kind1Author, 'fixed', 200)
    const thirdParty = editEvent('22'.repeat(32), otherPubkey, 'suggested', 250, [
      ['p', kind1Author],
      ['summary', 'please fix typo']
    ])
    const state = buildShortNoteEditState([author, thirdParty], kind1)
    expect(state.latestAuthorEdit?.id).toBe(author.id)
    expect(state.authorEdits).toHaveLength(1)
    expect(isAuthorShortNoteEdit(thirdParty, kind1)).toBe(false)
  })

  it('merges edited content onto kind 1', () => {
    const edit = editEvent('11'.repeat(32), kind1Author, 'revised', 200)
    expect(mergeEditedShortNote(kind1, edit).content).toBe('revised')
  })

  it('reads edit marker on kind 1111 replies', () => {
    const editId = 'ee'.repeat(32)
    const reply: Event = {
      id: 'ff'.repeat(32),
      pubkey: otherPubkey,
      kind: ExtendedKind.COMMENT,
      content: 'thanks',
      created_at: 400,
      tags: [
        ['E', noteId, '', kind1Author],
        ['e', noteId, '', 'reply', kind1Author],
        ['e', editId, '', 'edit', kind1Author]
      ],
      sig: 'sig'
    }
    expect(getReplyShortNoteEditId(reply)).toBe(editId)
  })
})
