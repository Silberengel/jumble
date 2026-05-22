import { describe, expect, it } from 'vitest'
import { parseNostrSpecAffectedKinds } from './nostr-spec-affected-kinds'

describe('parseNostrSpecAffectedKinds', () => {
  it('parses one kind per row and dedupes', () => {
    expect(
      parseNostrSpecAffectedKinds([
        { id: '1', value: '1' },
        { id: '2', value: ' 42 ' },
        { id: '3', value: '1' }
      ])
    ).toEqual([1, 42])
  })

  it('skips empty and invalid rows', () => {
    expect(
      parseNostrSpecAffectedKinds([
        { id: '1', value: '' },
        { id: '2', value: 'abc' },
        { id: '3', value: '-1' }
      ])
    ).toEqual([])
  })
})
