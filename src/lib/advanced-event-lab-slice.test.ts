import { describe, expect, it } from 'vitest'
import { parseLabSlice, serializeLabSlice } from '@/lib/advanced-event-lab-slice'

describe('parseLabSlice', () => {
  it('round-trips', () => {
    const v = { kind: 1, content: 'hello', tags: [['e', 'abc'], ['p', 'def']] }
    const s = serializeLabSlice(v)
    const p = parseLabSlice(s)
    expect(p).toEqual({ ok: true, value: v })
  })

  it('rejects bad kind', () => {
    expect(parseLabSlice('{"kind":"x","content":"","tags":[]}').ok).toBe(false)
  })
})
