import { describe, expect, it } from 'vitest'
import { diffTextInline } from './short-note-edit-diff'

describe('diffTextInline', () => {
  it('marks a replaced word as delete then insert', () => {
    const oldText =
      'I think you just gave client tags their first use case. Great edit. Probably nothing.'
    const newText =
      'I think you just gave client tags their first use case. Gratuitous edit. Probably nothing.'
    const parts = diffTextInline(oldText, newText)
    expect(parts.some((p) => p.type === 'delete' && p.value === 'Great')).toBe(true)
    expect(parts.some((p) => p.type === 'insert' && p.value === 'Gratuitous')).toBe(true)
    const reconstructed = parts
      .filter((p) => p.type !== 'delete')
      .map((p) => p.value)
      .join('')
    expect(reconstructed).toBe(newText)
  })

  it('returns a single equal part for identical text', () => {
    expect(diffTextInline('hello world', 'hello world')).toEqual([
      { type: 'equal', value: 'hello world' }
    ])
  })
})
