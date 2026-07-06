import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'

describe('note-renderable-kinds', () => {
  it('includes kind 1 after registry bootstrap', async () => {
    const { isRenderableNoteKind, getRenderableNoteKinds } = await import('@/lib/note-renderable-kinds')
    expect(getRenderableNoteKinds().length).toBeGreaterThan(0)
    expect(isRenderableNoteKind(kinds.ShortTextNote)).toBe(true)
  })

  it('includes kind 1 when loaded via content-renderers chain', async () => {
    await import('@/lib/kind-registry/content-renderers')
    const { isRenderableNoteKind, getRenderableNoteKinds } = await import('@/lib/note-renderable-kinds')
    expect(getRenderableNoteKinds().length).toBeGreaterThan(0)
    expect(isRenderableNoteKind(kinds.ShortTextNote)).toBe(true)
  })
})
