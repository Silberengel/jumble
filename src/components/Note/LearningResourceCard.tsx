import { ExtendedKind } from '@/constants'
import {
  formatAmbContentSize,
  parseAmbLearningResource,
  type AmbLearningResource
} from '@/lib/amb-learning-resource'
import { cn } from '@/lib/utils'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Download, ExternalLink, GraduationCap } from 'lucide-react'
import Image from '../Image'

function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground',
        className
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

function ResourceBody({
  resource,
  event,
  compact,
  autoLoadMedia
}: {
  resource: AmbLearningResource
  event: Event
  compact: boolean
  autoLoadMedia: boolean
}) {
  const { t } = useTranslation()
  const sizeLabel = resource.contentSizeBytes ? formatAmbContentSize(resource.contentSizeBytes) : ''
  const openLabel = resource.contentFileLabel
    ? t('Open {{format}} resource', {
        format: resource.contentFileLabel,
        defaultValue: `Open ${resource.contentFileLabel} resource`
      })
    : t('Open learning resource', { defaultValue: 'Open learning resource' })

  const previewUrl =
    resource.thumbnailUrl ||
    (resource.resourceTypes.some((type) => type.toLowerCase() === 'image') ? resource.contentUrl : undefined)

  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
          compact ? 'size-9' : 'size-10'
        )}
        aria-hidden
      >
        <GraduationCap className={compact ? 'size-4' : 'size-5'} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn('flex flex-wrap items-center gap-2', compact && 'sr-only')}>
          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('Learning resource', { defaultValue: 'Learning resource' })}
          </span>
          {resource.isAccessibleForFree ? (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-700 dark:text-emerald-400">
              {t('Free to use', { defaultValue: 'Free to use' })}
            </span>
          ) : null}
          {resource.client ? (
            <span className="text-[0.65rem] text-muted-foreground/80">{resource.client}</span>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className={cn('font-semibold leading-snug break-words', compact ? 'text-sm' : 'text-base')}>
            {resource.name}
          </div>
          {resource.description && resource.description !== resource.name ? (
            <p
              className={cn(
                'text-muted-foreground break-words',
                compact ? 'line-clamp-2 text-xs' : 'line-clamp-3 text-sm'
              )}
            >
              {resource.description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {resource.learningResourceTypeLabel ? (
            <MetaChip className="bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
              {resource.learningResourceTypeLabel}
            </MetaChip>
          ) : null}
          {resource.aboutLabel ? <MetaChip>{resource.aboutLabel}</MetaChip> : null}
          {resource.language ? (
            <MetaChip>
              {t('Language: {{code}}', {
                code: resource.language.toUpperCase(),
                defaultValue: resource.language.toUpperCase()
              })}
            </MetaChip>
          ) : null}
          {resource.licenseLabel ? <MetaChip>{resource.licenseLabel}</MetaChip> : null}
        </div>

        {resource.creatorName ? (
          <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            {t('Creator: {{name}}', {
              name: resource.creatorName,
              defaultValue: `Creator: ${resource.creatorName}`
            })}
          </p>
        ) : null}

        {previewUrl && !compact ? (
          <Image
            image={{ url: previewUrl, pubkey: event.pubkey }}
            className="aspect-video w-full max-w-md rounded-md border object-cover"
            hideIfError
            holdUntilClick={!autoLoadMedia}
          />
        ) : null}

        {resource.contentUrl ? (
          <a
            href={resource.contentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex max-w-full items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300',
              compact && 'px-2 py-1 text-xs'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {resource.contentFileLabel === 'PDF' || resource.contentFileLabel === 'Image' ? (
              <Download className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">
              {openLabel}
              {sizeLabel ? ` (${sizeLabel})` : ''}
            </span>
          </a>
        ) : null}

        {resource.taxonomies.length > 0 || resource.extensions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {resource.taxonomies.map((term) => (
              <MetaChip key={`${term.scheme ?? ''}:${term.term}`}>{term.term}</MetaChip>
            ))}
            {resource.extensions.map((ext) => (
              <MetaChip key={`${ext.key}:${ext.value}`}>
                {ext.key.includes(':') ? `${ext.key.split(':').pop()}: ${ext.value}` : `${ext.key}: ${ext.value}`}
              </MetaChip>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function LearningResourceCard({
  event,
  className,
  variant = 'full'
}: {
  event: Event
  className?: string
  variant?: 'full' | 'compact'
}) {
  const { i18n } = useTranslation()
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const resource = useMemo(
    () =>
      event.kind === ExtendedKind.LEARNING_RESOURCE
        ? parseAmbLearningResource(event, i18n.language)
        : null,
    [event, i18n.language]
  )

  if (!resource) {
    return (
      <div className={cn('rounded-lg border p-3 text-sm text-muted-foreground', className)}>
        <BookOpen className="mb-1 size-4" aria-hidden />
        {event.content?.trim() || 'Learning resource'}
      </div>
    )
  }

  const compact = variant === 'compact'

  return (
    <div
      className={cn(
        'rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-background to-teal-500/[0.06] shadow-sm',
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      <ResourceBody resource={resource} event={event} compact={compact} autoLoadMedia={autoLoadMedia} />
    </div>
  )
}
