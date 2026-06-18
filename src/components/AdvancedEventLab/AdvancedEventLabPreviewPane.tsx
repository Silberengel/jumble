import AsciidocArticle from '@/components/Note/LazyAsciidocArticle'
import MarkdownArticle from '@/components/Note/LazyMarkdownArticle'
import { Card } from '@/components/ui/card'
import { ExtendedKind } from '@/constants'
import { createFakeEvent } from '@/lib/event'
import { kinds } from 'nostr-tools'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export const AdvancedEventLabPreviewPane = memo(function AdvancedEventLabPreviewPane({
  markupMode,
  source,
  previewAuthorPubkey = null,
  previewEmojiTags
}: {
  markupMode: 'markdown' | 'asciidoc'
  source: string
  /** When set (hex pubkey), Markdown preview resolves custom `:shortcode:` from this author (NIP-30). */
  previewAuthorPubkey?: string | null
  /** `emoji` tags on the preview fake event (e.g. from the note being edited). */
  previewEmojiTags?: string[][]
}) {
  const { t } = useTranslation()

  const fakeEvent = useMemo(() => {
    const kind =
      markupMode === 'asciidoc' ? ExtendedKind.WIKI_ARTICLE : kinds.LongFormArticle
    const pk = (previewAuthorPubkey ?? '').trim().toLowerCase()
    const tags = (previewEmojiTags ?? []).map((row) => [...row])
    return createFakeEvent({
      content: source,
      kind,
      tags,
      pubkey: pk
    })
  }, [markupMode, source, previewAuthorPubkey, previewEmojiTags])

  if (!source.trim()) {
    return (
      <p className="text-left text-sm text-muted-foreground">{t('Advanced lab preview empty')}</p>
    )
  }

  return (
    <Card className="border-0 bg-transparent p-0 shadow-none">
      <div className="select-text min-w-0 max-w-none text-left text-sm">
        {markupMode === 'asciidoc' ? (
          <AsciidocArticle event={fakeEvent} hideImagesAndInfo={false} />
        ) : (
          <MarkdownArticle event={fakeEvent} hideMetadata lazyMedia={false} />
        )}
      </div>
    </Card>
  )
})
