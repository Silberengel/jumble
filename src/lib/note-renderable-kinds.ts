import '@/lib/kind-registry/bootstrap'
import { renderableKinds } from '@/lib/kind-registry/registry'

/**
 * Every kind the main `Note` component renders with a dedicated UI (not the unknown-event fallback).
 * Derived from the kind registry; used by notifications spell client filter.
 */
export const RENDERABLE_NOTE_KINDS_SORTED = renderableKinds()

export function isRenderableNoteKind(kind: number): boolean {
  return RENDERABLE_NOTE_KINDS_SORTED.includes(kind)
}
