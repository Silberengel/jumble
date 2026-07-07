import { buildNoteUrl, extractValidNoteId, parseNoteUrl } from '@/lib/note-navigation-url'
import { describe, expect, it } from 'vitest'

describe('note-navigation-url', () => {
  it('extractValidNoteId accepts nevent bech32', () => {
    const id =
      'nevent1qqxnzdecxverwd3cxsmnwvfkqy88wumn8ghj7mn0wvhxcmmv9upzq3huhccxt6h34eupz3jeynjgjgek8lel2f4adaea0svyk94a3njdqvzqqqr4guqy3ykw'
    expect(extractValidNoteId(id)).toBe(id)
  })

  it('parseNoteUrl accepts standard and contextual note paths', () => {
    const id = 'nevent1qqtest'
    expect(parseNoteUrl(`/notes/${id}`)?.noteId).toBe(id)
    expect(parseNoteUrl(`/feed/notes/${id}`)?.noteId).toBe(id)
  })

  it('buildNoteUrl preserves feed context', () => {
    expect(buildNoteUrl('nevent1qqtest', 'feed')).toBe('/feed/notes/nevent1qqtest')
    expect(buildNoteUrl('nevent1qqtest', null)).toBe('/notes/nevent1qqtest')
  })
})
