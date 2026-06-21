import { describe, expect, it } from 'vitest'
import { serializeComposerPreviewJson } from './build-composer-preview'

describe('serializeComposerPreviewJson', () => {
  it('returns publish-shaped draft JSON for a short note', () => {
    const json = serializeComposerPreviewJson({ content: 'hello world', kind: 1 })
    const parsed = JSON.parse(json) as {
      kind: number
      content: string
      created_at: number
      tags: string[][]
    }
    expect(parsed.kind).toBe(1)
    expect(parsed.content).toBe('hello world')
    expect(typeof parsed.created_at).toBe('number')
    expect(parsed.tags.some((t) => t[0] === 'client')).toBe(true)
  })

  it('omits client tag when addClientTag is false', () => {
    const json = serializeComposerPreviewJson({ content: 'x', kind: 1, addClientTag: false })
    const parsed = JSON.parse(json) as { tags: string[][] }
    expect(parsed.tags.some((t) => t[0] === 'client')).toBe(false)
  })
})
