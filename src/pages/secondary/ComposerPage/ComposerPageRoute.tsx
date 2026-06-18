import { lazy, Suspense } from 'react'

const ComposerPageLazy = lazy(() => import('./index'))

export default function ComposerPageRoute(props: { id?: string; index?: number }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ComposerPageLazy replySegment={props.id} index={props.index} />
    </Suspense>
  )
}

export function preloadComposerPageChunk(): void {
  void import('./index')
}
