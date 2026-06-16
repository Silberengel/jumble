import { lazy, Suspense, type ComponentProps } from 'react'

const PostEditorImpl = lazy(() => import('./index'))

export default function LazyPostEditor(props: ComponentProps<typeof PostEditorImpl>) {
  return (
    <Suspense fallback={null}>
      <PostEditorImpl {...props} />
    </Suspense>
  )
}
