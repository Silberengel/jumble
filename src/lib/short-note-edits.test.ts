import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildShortNoteEditState,
  baselineShortNoteContentForProposal,
  getEditProposalSummary,
  getReplyShortNoteEditId,
  getShortNoteEditTargetId,
  isAuthorShortNoteEdit,
  isIncomingCollaborativeEditProposalNotification,
  mergeEditedShortNote,
  mergeShortNoteEditEvents,
  pickLatestAuthorShortNoteEdit,
  resolveShortNoteParentForReplyBlurb
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
  it('reads edit target from kind 1010 with relay + author on e tag', () => {
    const edit: Event = {
      id: '72d2b33825f88eba916a262354360a93160c26f1cc2e76aaae9265b480650f06',
      pubkey: kind1Author,
      kind: ExtendedKind.SHORT_NOTE_EDIT,
      content: 'revised body',
      created_at: 200,
      tags: [
        [
          'e',
          noteId,
          'https://mercury-relay.imwald.eu',
          kind1Author
        ]
      ],
      sig: 'sig'
    }
    expect(getShortNoteEditTargetId(edit)).toBe(noteId)
    expect(isAuthorShortNoteEdit(edit, kind1)).toBe(true)
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
    expect(state.editProposals).toHaveLength(1)
    expect(state.editProposals[0]?.id).toBe(thirdParty.id)
    expect(isAuthorShortNoteEdit(thirdParty, kind1)).toBe(false)
  })

  it('reads proposal summary tag', () => {
    const proposal = editEvent('22'.repeat(32), otherPubkey, 'suggested', 250, [
      ['p', kind1Author],
      ['summary', 'typo fix']
    ])
    expect(getEditProposalSummary(proposal)).toBe('typo fix')
  })

  it('detects incoming collaborative edit proposal notifications', () => {
    const proposal = editEvent('22'.repeat(32), otherPubkey, 'suggested', 250, [
      ['p', kind1Author],
      ['summary', 'please fix typo']
    ])
    expect(isIncomingCollaborativeEditProposalNotification(proposal, kind1Author)).toBe(true)
    expect(isIncomingCollaborativeEditProposalNotification(proposal, otherPubkey)).toBe(false)
    const authorEdit = editEvent('33'.repeat(32), kind1Author, 'self edit', 260)
    expect(isIncomingCollaborativeEditProposalNotification(authorEdit, kind1Author)).toBe(false)
  })

  it('baseline for proposals uses latest author edit', () => {
    const author = editEvent('11'.repeat(32), kind1Author, 'revised', 200)
    const state = buildShortNoteEditState([author], kind1)
    expect(baselineShortNoteContentForProposal(kind1, state)).toBe('revised')
    expect(baselineShortNoteContentForProposal(kind1)).toBe('original')
  })

  it('merges edited content onto kind 1', () => {
    const edit = editEvent('11'.repeat(32), kind1Author, 'revised', 200)
    expect(mergeEditedShortNote(kind1, edit).content).toBe('revised')
  })

  it('mergeShortNoteEditEvents dedupes by id and keeps latest author revision', () => {
    const e1 = editEvent('11'.repeat(32), kind1Author, 'v1', 200)
    const e2 = editEvent('22'.repeat(32), kind1Author, 'v2', 300)
    const merged = mergeShortNoteEditEvents([e1], [e1, e2], kind1)
    expect(merged.authorEdits.map((e) => e.id)).toEqual([e1.id, e2.id])
    expect(merged.latestAuthorEdit?.content).toBe('v2')
  })

  it('reply blurb uses original kind-1 when reply has no edit marker', () => {
    const reply: Event = {
      id: 'ff'.repeat(32),
      pubkey: otherPubkey,
      kind: kinds.ShortTextNote,
      content: 'test',
      created_at: 400,
      tags: [['e', noteId, '', 'reply', kind1Author]],
      sig: 'sig'
    }
    expect(resolveShortNoteParentForReplyBlurb(kind1, reply).content).toBe('original')
  })

  it('reply blurb uses tagged kind-1010 revision when reply cites edit', () => {
    const edit = editEvent('11'.repeat(32), kind1Author, 'revised blurb text', 250)
    const reply: Event = {
      id: 'ff'.repeat(32),
      pubkey: otherPubkey,
      kind: ExtendedKind.COMMENT,
      content: 'after edit',
      created_at: 400,
      tags: [
        ['E', noteId, '', kind1Author],
        ['e', noteId, '', 'reply', kind1Author],
        ['e', edit.id, '', 'edit', kind1Author]
      ],
      sig: 'sig'
    }
    expect(resolveShortNoteParentForReplyBlurb(kind1, reply, edit).content).toBe('revised blurb text')
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
