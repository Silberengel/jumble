import { ExtendedKind } from '@/constants'
import {
  getPublicationIndexMetadataFromEvent,
  type PublicationAuthor
} from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPageOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { ExternalLink } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import PublicationCoverFallback from './PublicationCoverFallback'
import PublicationCoverImage from './PublicationCoverImage'
import PublicationBooklistButton from './PublicationBooklistButton'
import PublicationIndexBody from './PublicationIndexBody'
import PublicationSourceEventLink from './PublicationSourceEventLink'

function formatAuthorLine(authors: PublicationAuthor[]): string {
  if (authors.length === 0) return ''
  return authors
    .map(({ name, role }) => {
      const normalizedRole = role?.trim().toLowerCase()
      if (!normalizedRole || normalizedRole === 'author') return name
      return `${name} (${role})`
    })
    .join(' · ')
}

function formatPublicationType(type: string): string {
  return type
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sourceHostname(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, '')
  } catch {
    return source
  }
}

function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  )
}

export default function PublicationIndexMetadata({
  event,
  variant = 'compact',
  showTitle = true,
  className
}: {
  event: Event
  variant?: 'compact' | 'full'
  showTitle?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getPublicationIndexMetadataFromEvent(event), [event])

  if (event.kind !== ExtendedKind.PUBLICATION) return null

  const authorLine = formatAuthorLine(metadata.authors)
  const isFull = variant === 'full'
  const title =
    metadata.title?.trim() ||
    event.tags.find((tag) => tag[0] === 'd')?.[1]?.replace(/-/g, ' ') ||
    t('Publication Note')

  const metaChips: React.ReactNode[] = []
  if (metadata.type) {
    metaChips.push(<MetaChip key="type">{formatPublicationType(metadata.type)}</MetaChip>)
  }
  if (metadata.language) {
    metaChips.push(<MetaChip key="lang">{metadata.language.toUpperCase()}</MetaChip>)
  }
  if (metadata.version) {
    metaChips.push(<MetaChip key="version">{t('Publication version', { version: metadata.version })}</MetaChip>)
  }
  if (metadata.sectionCount > 0) {
    metaChips.push(
      <MetaChip key="sections">
        {t('Publication sections', { count: metadata.sectionCount })}
      </MetaChip>
    )
  }

  const tagsComponent =
    metadata.tags.length > 0 ? (
      <div className="flex min-w-0 flex-wrap gap-1">
        {metadata.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => {
              e.stopPropagation()
              push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
            }}
          >
            <span className="shrink-0">#</span>
            <span className="min-w-0 truncate">{tag}</span>
          </button>
        ))}
      </div>
    ) : null

  return (
    <div className={cn('min-w-0 space-y-2', isFull && 'space-y-4', className)}>
      {isFull && metadata.image?.trim() ? (
        <PublicationCoverImage
          imageUrl={metadata.image.trim()}
          pubkey={event.pubkey}
          autoLoadMedia={autoLoadMedia}
          size="default"
          layout="stacked"
          className="mb-0"
        />
      ) : isFull ? (
        <PublicationCoverFallback layout="stacked" size="default" className="mb-0" />
      ) : null}

      {showTitle ? (
        <div
          className={cn(
            'min-w-0 font-semibold break-words text-foreground',
            isFull ? 'text-2xl leading-tight sm:text-3xl' : 'text-xl sm:line-clamp-2'
          )}
        >
          {title}
        </div>
      ) : null}

      {authorLine ? (
        <div
          className={cn(
            'min-w-0 break-words text-muted-foreground',
            isFull ? 'text-base sm:text-lg' : 'text-sm line-clamp-2'
          )}
        >
          {authorLine}
        </div>
      ) : null}

      {metaChips.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">{metaChips}</div>
      ) : null}

      {metadata.releaseDate ? (
        <div className={cn('text-muted-foreground', isFull ? 'text-sm' : 'text-xs')}>
          {t('Publication released', { date: metadata.releaseDate })}
        </div>
      ) : null}

      <PublicationSourceEventLink
        event={event}
        className={isFull ? 'text-sm' : 'text-xs'}
      />

      {metadata.summary ? (
        <div
          className={cn(
            'min-w-0 break-words text-muted-foreground',
            isFull ? 'text-base leading-relaxed' : 'text-sm line-clamp-3'
          )}
        >
          {metadata.summary}
        </div>
      ) : null}

      {metadata.source || tagsComponent || isFull ? (
        <div className="flex min-w-0 flex-col gap-2">
          {metadata.source ? (
            <a
              href={metadata.source}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex min-w-0 max-w-full items-center gap-1.5 text-primary hover:underline',
                isFull ? 'text-sm' : 'text-xs'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{sourceHostname(metadata.source)}</span>
            </a>
          ) : null}

          {tagsComponent}

          {isFull ? <PublicationBooklistButton event={event} className="w-fit self-start" /> : null}
        </div>
      ) : null}

      {isFull && metadata.sectionCount > 0 ? (
        <PublicationIndexBody event={event} autoStartReading={isFull} />
      ) : null}
    </div>
  )
}
