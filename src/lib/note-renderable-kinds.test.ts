import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'

// Cold import of the kind-registry handler chain is fast in isolation but can take
// minutes of wall time under full-suite worker contention in jsdom.
const REGISTRY_IMPORT_TIMEOUT_MS = 120_000

describe('note-renderable-kinds', () => {
  it('includes kind 1 after registry bootstrap', async () => {
    const { isRenderableNoteKind, getRenderableNoteKinds } = await import('@/lib/note-renderable-kinds')
    expect(getRenderableNoteKinds().length).toBeGreaterThan(0)
    expect(isRenderableNoteKind(kinds.ShortTextNote)).toBe(true)
  }, REGISTRY_IMPORT_TIMEOUT_MS)

  it('includes kind 1 when loaded via content-renderers chain', async () => {
    await import('@/lib/kind-registry/content-renderers')
    const { isRenderableNoteKind, getRenderableNoteKinds } = await import('@/lib/note-renderable-kinds')
    expect(getRenderableNoteKinds().length).toBeGreaterThan(0)
    expect(isRenderableNoteKind(kinds.ShortTextNote)).toBe(true)
  }, REGISTRY_IMPORT_TIMEOUT_MS)
})
