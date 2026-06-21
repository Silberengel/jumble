import ClientTag from '@/components/ClientTag'
import { Card } from '@/components/ui/card'
import { ExtendedKind } from '@/constants'
import {
  buildComposerPreviewEvent,
  composerPreviewHasBody,
  type ComposerPreviewInput
} from '@/lib/build-composer-preview'
import { cn } from '@/lib/utils'
import { kinds } from 'nostr-tools'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ContentPreview from '../../ContentPreview'
import Content from '../../Content'
import Highlight from '../../Note/Highlight'
import MusicTrackNote from '../../Note/MusicTrackNote'
import MarkdownArticle from '../../Note/LazyMarkdownArticle'
import AsciidocArticle from '../../Note/LazyAsciidocArticle'

export default function Preview(props: ComposerPreviewInput & { className?: string }) {
  const {
    className,
    content,
    kind = 1,
    highlightData,
    webBookmarkData,
    pollCreateData,
    mediaImetaTags,
    mediaUrl,
    articleMetadata,
    musicTrackMetadata,
    extraPreviewTags,
    addClientTag = true,
    contentWarning
  } = props
  const { t } = useTranslation()

  const previewInput = useMemo(
    (): ComposerPreviewInput => ({
      content,
      kind,
      highlightData,
      webBookmarkData,
      pollCreateData,
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      musicTrackMetadata,
      extraPreviewTags,
      addClientTag,
      contentWarning
    }),
    [
      content,
      kind,
      highlightData,
      webBookmarkData,
      pollCreateData,
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      musicTrackMetadata,
      extraPreviewTags,
      addClientTag,
      contentWarning
    ]
  )

  const fakeEvent = useMemo(() => buildComposerPreviewEvent(previewInput), [previewInput])

  const hasPreviewBody = useMemo(() => composerPreviewHasBody(previewInput), [previewInput])

  const selectableClass = 'select-text'
  const withClientBadge = (node: ReactNode) =>
    addClientTag ? (
      <div className="space-y-1.5">
        <div className="flex min-h-[1.125rem] items-center px-0.5">
          <ClientTag event={fakeEvent} />
        </div>
        {node}
      </div>
    ) : (
      node
    )

  if (!hasPreviewBody) {
    return (
      <Card className={cn('p-3 text-sm text-muted-foreground', className, selectableClass)}>
        {t('Post editor preview empty')}
      </Card>
    )
  }

  if (kind === ExtendedKind.POLL) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <ContentPreview event={fakeEvent} />
      </Card>
    )
  }

  if (kind === kinds.Highlights) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <Highlight event={fakeEvent} />
      </Card>
    )
  }

  if (kind === ExtendedKind.WEB_BOOKMARK) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <ContentPreview event={fakeEvent} />
      </Card>
    )
  }

  if (
    kind === kinds.ShortTextNote ||
    kind === ExtendedKind.SHORT_NOTE_EDIT ||
    kind === ExtendedKind.COMMENT ||
    kind === ExtendedKind.VOICE_COMMENT
  ) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} lazyMedia={false} />
      </Card>
    )
  }

  if (kind === ExtendedKind.DISCUSSION) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} lazyMedia={false} />
      </Card>
    )
  }

  if (kind === kinds.LongFormArticle) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} lazyMedia={false} />
      </Card>
    )
  }

  if (kind === ExtendedKind.WIKI_ARTICLE) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <AsciidocArticle event={fakeEvent} hideImagesAndInfo={false} />
      </Card>
    )
  }

  if (kind === ExtendedKind.NOSTR_SPECIFICATION) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} lazyMedia={false} />
      </Card>
    )
  }

  if (kind === ExtendedKind.PUBLICATION_CONTENT) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <AsciidocArticle event={fakeEvent} hideImagesAndInfo={false} />
      </Card>
    )
  }

  if (kind === ExtendedKind.MUSIC_TRACK) {
    return withClientBadge(
      <Card className={cn('p-3', className, selectableClass)}>
        <MusicTrackNote event={fakeEvent} loadMedia className="mt-0" />
      </Card>
    )
  }

  return withClientBadge(
    <Card className={cn('p-3', className, selectableClass)}>
      <Content event={fakeEvent} className="h-full" mustLoadMedia />
    </Card>
  )
}
