import { lazy, Suspense, type ComponentProps } from 'react'

const MarkdownArticleImpl = lazy(() => import('./MarkdownArticle/MarkdownArticle'))

export default function LazyMarkdownArticle(
  props: ComponentProps<typeof MarkdownArticleImpl>
) {
  return (
    <Suspense fallback={null}>
      <MarkdownArticleImpl {...props} />
    </Suspense>
  )
}
