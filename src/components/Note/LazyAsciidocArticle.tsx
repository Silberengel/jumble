import { lazy, Suspense, type ComponentProps } from 'react'

const AsciidocArticleImpl = lazy(() => import('./AsciidocArticle/AsciidocArticle'))

export default function LazyAsciidocArticle(
  props: ComponentProps<typeof AsciidocArticleImpl>
) {
  return (
    <Suspense fallback={null}>
      <AsciidocArticleImpl {...props} />
    </Suspense>
  )
}
