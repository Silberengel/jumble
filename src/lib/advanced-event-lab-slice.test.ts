import { describe, expect, it } from 'vitest'
import {
  parseLabSlice,
  serializeLabSlice,
  serializePublishPreviewLabJson
} from '@/lib/advanced-event-lab-slice'

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

describe('serializePublishPreviewLabJson', () => {
  it('includes Imwald client tag by default', () => {
    const json = serializePublishPreviewLabJson({ kind: 1, content: 'hi', tags: [['d', 'x']] })
    const o = JSON.parse(json) as { tags: string[][] }
    expect(o.tags.some((t) => t[0] === 'client' && t[1] === 'imwald')).toBe(true)
  })

  it('omits client tag when addClientTag is false', () => {
    const json = serializePublishPreviewLabJson(
      { kind: 1, content: 'hi', tags: [['d', 'x']] },
      { addClientTag: false }
    )
    const o = JSON.parse(json) as { tags: string[][] }
    expect(o.tags.some((t) => t[0] === 'client')).toBe(false)
  })

  it('merges composer content-warning settings into preview tags', () => {
    const json = serializePublishPreviewLabJson(
      { kind: 1, content: 'hi', tags: [['content-warning', 'Spoilers']] },
      { contentWarning: { isNsfw: true, contentWarningLabel: 'Violence' } }
    )
    const o = JSON.parse(json) as { tags: string[][] }
    expect(o.tags.filter((t) => t[0] === 'content-warning')).toEqual([['content-warning', 'Violence']])
  })
})
