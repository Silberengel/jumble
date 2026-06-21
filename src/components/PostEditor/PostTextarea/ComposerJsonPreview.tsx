import { cn } from '@/lib/utils'
import {
  composerPreviewHasBody,
  serializeComposerPreviewJson,
  type ComposerPreviewInput
} from '@/lib/build-composer-preview'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function ComposerJsonPreview({
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
}: ComposerPreviewInput & { className?: string }) {
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

  const json = useMemo(
    () => serializeComposerPreviewJson(previewInput),
    [previewInput]
  )

  const hasBody = useMemo(() => composerPreviewHasBody(previewInput), [previewInput])

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2', className)}>
      <p className="shrink-0 text-xs text-muted-foreground">
        {t('Advanced lab json preview hint')}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain popover-scroll-y rounded-md border border-border bg-muted/20 p-3">
        <pre className="text-xs whitespace-pre-wrap break-words font-mono select-text text-foreground">
          {hasBody ? json : '{}'}
        </pre>
      </div>
    </div>
  )
}
