import type { TPageRef } from '@/types'
import type { Event } from 'nostr-tools'
import { forwardRef, lazy, Suspense } from 'react'
import NotePageInstantShell from './NotePageInstantShell'

const NotePageLazy = lazy(() => import('./index'))

/** Sync entry: instant shell while the lazy NotePage chunk loads. */
const NotePageRoute = forwardRef<
  TPageRef,
  { id?: string; index?: number; hideTitlebar?: boolean; initialEvent?: Event }
>((props, ref) => (
  <Suspense fallback={<NotePageInstantShell {...props} />}>
    <NotePageLazy {...props} ref={ref} />
  </Suspense>
))
NotePageRoute.displayName = 'NotePageRoute'
export default NotePageRoute

/** Warm the note panel chunk on feed hover / pointer-down. */
export function preloadNotePageChunk(): void {
  void import('./index')
}
