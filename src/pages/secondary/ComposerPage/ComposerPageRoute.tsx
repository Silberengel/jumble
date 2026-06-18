import type { TPageRef } from '@/types'
import { forwardRef, lazy, Suspense } from 'react'

const ComposerPageLazy = lazy(() => import('./index'))

const ComposerPageRoute = forwardRef<TPageRef, { id?: string; index?: number }>((props, ref) => (
  <Suspense
    fallback={
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading…
      </div>
    }
  >
    <ComposerPageLazy replySegment={props.id} index={props.index} ref={ref} />
  </Suspense>
))
ComposerPageRoute.displayName = 'ComposerPageRoute'
export default ComposerPageRoute

export function preloadComposerPageChunk(): void {
  void import('./index')
}
