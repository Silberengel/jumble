import { matchAppRoute } from '@/routes'
import { cloneElement, createRef } from 'react'
import { describe, expect, it } from 'vitest'

describe('secondary note route mounting', () => {
  it('matchAppRoute resolves contextual feed note URLs', () => {
    const path = '/feed/notes/nevent1qqxnzdecxverwd3cxsmnwvfkqy88wumn8ghj7mn0wvhxcmmv9upzq3huhccxt6h34eupz3jeynjgjgek8lel2f4adaea0svyk94a3njdqvzqqqr4guqy3ykw'
    const matched = matchAppRoute(path)
    expect(matched?.element).toBeTruthy()
    expect(matched?.params.id).toContain('nevent1')
  })

  it('cloneElement applies NotePageRoute props without throwing', () => {
    const path = '/feed/notes/nevent1qqtestnoteid'
    const matched = matchAppRoute(path)
    expect(matched?.element).toBeTruthy()
    const ref = createRef()
    expect(() =>
      cloneElement(matched!.element!, {
        id: matched!.params.id,
        index: 0,
        ref
      })
    ).not.toThrow()
  })
})
