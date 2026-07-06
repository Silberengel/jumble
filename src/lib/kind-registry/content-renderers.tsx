import { ExtendedKind } from '@/constants'
import { isNip18RepostKind } from '@/lib/event'
import { mergeNip84MarkedIntervals, renderPlaintextWithNip84MergedMarks } from '@/lib/nip84-op-body-marks'
import {
  findTrailingStringifiedNostrEvent,
  type StringifiedNostrEventMatch
} from '@/lib/nostr-event-json'
import { isAsciidocPublicationSectionKind } from '@/lib/publication-section-content-kind'
import { cn } from '@/lib/utils'
import { kinds } from 'nostr-tools'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import client from '@/services/client.service'
import EmbeddedKindCard from '@/components/Embedded/EmbeddedKindCard'
import { HttpUrlOpenGraphOrLink } from '@/components/Embedded/HttpUrlOpenGraphOrLink'
import MarkdownArticle from '@/components/Note/LazyMarkdownArticle'
import AsciidocArticle from '@/components/Note/LazyAsciidocArticle'
import ShortNoteEditedContent from '@/components/Note/ShortNoteEditedContent'
import StandardTextNoteEmbedCard from '@/components/Note/StandardTextNoteEmbedCard'
import NotificationEventCard from '@/components/Note/NotificationEventCard'
import type { RenderCtx } from './types'
import { Repeat2 } from 'lucide-react'

function isStringifiedJsonContent(content?: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  if (!trimmed) return false
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!looksLikeJson) return false
  try {
    const parsed = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

function cacheEmbeddedRepostTarget(hostEvent: import('nostr-tools').Event, targetEvent: import('nostr-tools').Event) {
  client.addEventToCache(targetEvent)
  const targetSeenOn = client.getSeenEventRelays(targetEvent.id)
  if (targetSeenOn.length > 0) return
  client.getSeenEventRelays(hostEvent.id).forEach((relay) => {
    client.trackEventSeenOn(targetEvent.id, relay)
  })
}

function StringifiedNostrEventPreviewCard({
  hostEvent,
  targetEvent,
  className,
  deferAuthorAvatar = false
}: {
  hostEvent: import('nostr-tools').Event
  targetEvent: import('nostr-tools').Event
  className?: string
  deferAuthorAvatar?: boolean
}) {
  const { t } = useTranslation()

  useEffect(() => {
    cacheEmbeddedRepostTarget(hostEvent, targetEvent)
  }, [hostEvent.id, targetEvent])

  const boostHeader = (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Repeat2 className="size-4 shrink-0" aria-hidden />
      <span>{t('Boost')}</span>
    </div>
  )

  const kind = targetEvent.kind
  if (kind === kinds.ShortTextNote || kind === ExtendedKind.COMMENT) {
    return (
      <StandardTextNoteEmbedCard
        event={targetEvent}
        className={className}
        header={boostHeader}
        deferAuthorAvatar={deferAuthorAvatar}
      />
    )
  }

  return (
    <EmbeddedKindCard event={targetEvent} className={className} />
  )
}

function StringifiedNostrEventContent({
  hostEvent,
  match,
  className,
  hideMetadata,
  autoLoadMedia,
  fullCalendarInvite,
  deferAuthorAvatar = false
}: {
  hostEvent: import('nostr-tools').Event
  match: StringifiedNostrEventMatch
  className?: string
  hideMetadata?: boolean
  autoLoadMedia: boolean
  fullCalendarInvite?: { event: import('nostr-tools').Event; naddr: string }
  deferAuthorAvatar?: boolean
}) {
  const textEvent = match.textBefore.trim()
    ? { ...hostEvent, content: match.textBefore }
    : undefined

  return (
    <div className={cn('space-y-2', className)}>
      {textEvent ? (
        <MarkdownArticle
          event={textEvent}
          hideMetadata={hideMetadata}
          lazyMedia={!autoLoadMedia}
          fullCalendarInvite={fullCalendarInvite}
        />
      ) : null}
      <StringifiedNostrEventPreviewCard
        hostEvent={hostEvent}
        targetEvent={match.event}
        deferAuthorAvatar={deferAuthorAvatar}
      />
    </div>
  )
}

export function RepostEventContent({ event, className }: { event: import('nostr-tools').Event; className?: string }) {
  const embeddedEvent = findTrailingStringifiedNostrEvent(event.content)
  if (embeddedEvent) {
    return (
      <StringifiedNostrEventPreviewCard
        hostEvent={event}
        targetEvent={embeddedEvent.event}
        className={className}
      />
    )
  }
  return <NotificationEventCard className={className} event={event} />
}

/** Shared markdown / asciidoc / nip84 / edit path for text-like kinds. */
export function renderMarkdownContent(ctx: RenderCtx, className = 'mt-2') {
  const { displayEvent, hideMetadata, autoLoadMedia, fullCalendarInvite, deferAuthorAvatar } = ctx

  if (
    ctx.surface === 'embed' &&
    !ctx.showFull &&
    (displayEvent.kind === kinds.ShortTextNote || displayEvent.kind === ExtendedKind.COMMENT)
  ) {
    return (
      <StandardTextNoteEmbedCard event={displayEvent} className={cn(className, 'mt-0')} deferAuthorAvatar={deferAuthorAvatar} />
    )
  }

  if (isNip18RepostKind(displayEvent.kind)) {
    return <RepostEventContent className={className} event={displayEvent} />
  }

  const embeddedEvent = findTrailingStringifiedNostrEvent(displayEvent.content ?? '')
  if (embeddedEvent) {
    return (
      <StringifiedNostrEventContent
        hostEvent={displayEvent}
        match={embeddedEvent}
        className={className}
        hideMetadata={hideMetadata}
        autoLoadMedia={autoLoadMedia}
        fullCalendarInvite={fullCalendarInvite}
        deferAuthorAvatar={deferAuthorAvatar}
      />
    )
  }

  if (isStringifiedJsonContent(displayEvent.content)) {
    return (
      <pre
        className={cn(
          'rounded-md border border-border bg-muted/35 p-3 text-sm whitespace-pre-wrap break-words',
          className
        )}
      >
        {displayEvent.content}
      </pre>
    )
  }

  if (isAsciidocPublicationSectionKind(displayEvent.kind)) {
    return (
      <AsciidocArticle
        className={className}
        event={displayEvent}
        hideImagesAndInfo={hideMetadata}
      />
    )
  }

  if (
    ctx.nip84HighlightEvents?.length &&
    displayEvent.kind === kinds.ShortTextNote
  ) {
    const merged = mergeNip84MarkedIntervals(
      displayEvent.content ?? '',
      ctx.nip84HighlightEvents,
      displayEvent.id
    )
    if (merged.length > 0) {
      return (
        <div
          className={cn(
            'note-content text-base font-normal whitespace-pre-wrap break-words',
            className
          )}
        >
          {renderPlaintextWithNip84MergedMarks(displayEvent.content ?? '', merged)}
        </div>
      )
    }
  }

  if (
    ctx.isShortNoteEdited &&
    ctx.shortNoteEditOriginalContent != null &&
    ctx.shortNoteEditRevisedContent != null
  ) {
    return (
      <ShortNoteEditedContent
        original={ctx.shortNoteEditOriginalContent}
        revised={ctx.shortNoteEditRevisedContent}
        displayEvent={displayEvent}
        className={className}
        hideMetadata={hideMetadata}
        lazyMedia={!autoLoadMedia}
        fullCalendarInvite={fullCalendarInvite}
      />
    )
  }

  return (
    <MarkdownArticle
      className={className}
      event={
        isNip18RepostKind(displayEvent.kind)
          ? { ...displayEvent, content: '' }
          : displayEvent
      }
      hideMetadata={hideMetadata}
      lazyMedia={!autoLoadMedia}
      fullCalendarInvite={fullCalendarInvite}
      duplicateWebPreviewCleanedUrlHints={ctx.duplicateWebPreviewCleanedUrlHints}
    />
  )
}

export function bodyClass(ctx: RenderCtx, extra?: string) {
  return cn('mt-2', ctx.className, extra)
}

export { getWebBookmarkReplaceableEventNaddr } from '@/lib/web-bookmark-nip'
export { getWebBookmarkArticleUrl } from '@/lib/rss-article'
export { HttpUrlOpenGraphOrLink }
