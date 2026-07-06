import '@/lib/kind-registry/bootstrap'
import { isKindRenderable } from '@/lib/kind-registry/render'
import { normalizeEventKind } from '@/lib/kind-registry/normalize-kind'
import { renderableKinds } from '@/lib/kind-registry/registry'

/**
 * Every kind the main `Note` component renders with a dedicated UI (not the unknown-event fallback).
 * Derived from the kind registry; used by notifications spell client filter.
 */
export function getRenderableNoteKinds(): number[] {
  return renderableKinds()
}

export function isRenderableNoteKind(kind: number): boolean {
  return isKindRenderable(normalizeEventKind(kind))
}

export { isKindRenderable }
