import { useSmartNoteNavigationOptional } from '@/PageManager'
import { ExtendedKind, isNip71StyleVideoKind, publicAssetUrl } from '@/constants'
import { isRenderableNoteKind } from '@/lib/note-renderable-kinds'
import {
  getHttpUrlFromITags,
  getParentBech32Id,
  isNip18RepostKind,
  isNip25ReactionKind,
  isNsfwEvent
} from '@/lib/event'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { mergeNip84MarkedIntervals, renderPlaintextWithNip84MergedMarks } from '@/lib/nip84-op-body-marks'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { encodeArticleLikePublicationNaddr, openAlexandriaPublicationFromNaddr, toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { Event, kinds } from 'nostr-tools'
import { isCalendarEventKind } from '@/lib/calendar-event'
import { mergeTranslatedNote, useNoteTranslation } from '@/lib/note-translation-display'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getWebBookmarkArticleUrl,
  getWebExternalReactionTargetUrl,
  isRssThreadSyntheticParentEvent
} from '@/lib/rss-article'
import {
  findTrailingStringifiedNostrEvent,
  type StringifiedNostrEventMatch
} from '@/lib/nostr-event-json'
import { CreateHighlightContext } from './CreateHighlightContext'
import SelectionHighlightTrigger from './SelectionHighlightTrigger'
import AudioPlayer from '../AudioPlayer'
import WebPreview from '../WebPreview'
import ClientTag from '../ClientTag'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import NoteOptions from '../NoteOptions'
import ParentNotePreview from '../ParentNotePreview'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import { MessageSquare, Repeat2 } from 'lucide-react'
import CommunityDefinition from './CommunityDefinition'
import GroupMetadata from './GroupMetadata'
import Highlight from './Highlight'
import ContentPreview from '../ContentPreview'

import IValue from './IValue'
import LiveEvent from './LiveEvent'
import MarkdownArticle from './MarkdownArticle/MarkdownArticle'
import AsciidocArticle from './AsciidocArticle/AsciidocArticle'
import PublicationCard from './PublicationCard'
import WikiCard from './WikiCard'
import LongFormCard from './LongFormCard'
import MutedNote from './MutedNote'
import NsfwNote from './NsfwNote'
import PictureNote from './PictureNote'
import Poll from './Poll'
import ZapPoll from './ZapPoll'
import NotificationEventCard from './NotificationEventCard'
import ReactionEmojiDisplay from './ReactionEmojiDisplay'
import UnknownNote from './UnknownNote'
import NoteKindLabel from './NoteKindLabel'
import { Button } from '@/components/ui/button'
import VideoNote from './VideoNote'
import RelayReview from './RelayReview'
import Zap from './Zap'
import CitationCard from '@/components/CitationCard'
import FollowPackPreview from '../ContentPreview/FollowPackPreview'
import CalendarEventContent from '../CalendarEventContent'
import GitRepublicEventCard from './GitRepublicEventCard'

const ASCIIDOC_CONTENT_KINDS = new Set<number>([
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE
])

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

function cacheEmbeddedRepostTarget(hostEvent: Event, targetEvent: Event) {
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
  hostEvent: Event
  targetEvent: Event
  className?: string
  deferAuthorAvatar?: boolean
}) {
  const { t } = useTranslation()

  useEffect(() => {
    cacheEmbeddedRepostTarget(hostEvent, targetEvent)
  }, [hostEvent.id, targetEvent])

  return (
    <div
      data-embedded-note
      className={cn(
        'not-prose rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm',
        className
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Repeat2 className="size-4 shrink-0" aria-hidden />
        <span>{t('Boost')}</span>
      </div>
      <div className="flex min-w-0 gap-2">
        <UserAvatar
          userId={targetEvent.pubkey}
          size="tiny"
          className="mt-0.5 shrink-0"
          deferRemoteAvatar={deferAuthorAvatar}
        />
        <div className="min-w-0 flex-1">
          <ContentPreview event={targetEvent} className="line-clamp-4" />
        </div>
      </div>
    </div>
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
  hostEvent: Event
  match: StringifiedNostrEventMatch
  className?: string
  hideMetadata?: boolean
  autoLoadMedia: boolean
  fullCalendarInvite?: { event: Event; naddr: string }
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

function RepostEventContent({ event, className }: { event: Event; className?: string }) {
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

export default function Note({
  event,
  originalNoteId,
  size = 'normal',
  className,
  hideParentNotePreview = false,
  showFull = false,
  disableClick = false,
  /** From {@link MainNoteCard}: embedded cards need eager poll results (viewport IO often misses nested scrollers). */
  embedded,
  fullCalendarInvite,
  zapPollVoteHighlightOption,
  nip84HighlightEvents,
  deferAuthorAvatar = false
}: {
  event: Event
  originalNoteId?: string
  size?: 'normal' | 'small'
  className?: string
  hideParentNotePreview?: boolean
  showFull?: boolean
  disableClick?: boolean
  embedded?: boolean
  /** When viewing a kind-24 invite, use this to replace the embedded calendar with the full card (RSVP) in content */
  fullCalendarInvite?: { event: Event; naddr: string }
  /** Profile: highlight option when this row is from a zap vote receipt. */
  zapPollVoteHighlightOption?: number
  /** Kind-9802 events that cite this note; when spans match {@link displayEvent.content}, render green marks (note page OP). */
  nip84HighlightEvents?: Event[]
  /** When true, defer remote profile avatars until near-viewport (dense lists e.g. merged NIP-50 search). */
  deferAuthorAvatar?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const parentEventId = useMemo(
    () => (hideParentNotePreview ? undefined : getParentBech32Id(event)),
    [event, hideParentNotePreview]
  )
  const parentFetchRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const contentPolicy = useContentPolicyOptional()
  const defaultShowNsfw = contentPolicy?.defaultShowNsfw ?? true
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const [showNsfw, setShowNsfw] = useState(false)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const [showMuted, setShowMuted] = useState(false)
  const [highlightData, setHighlightData] = useState<HighlightData | undefined>(undefined)
  const [highlightDefaultContent, setHighlightDefaultContent] = useState<string>('')
  const [postEditorOpen, setPostEditorOpen] = useState(false)
  const [publicMessageTo, setPublicMessageTo] = useState<string | null>(null)
  const [callInviteContent, setCallInviteContent] = useState<string | null>(null)
  const noteTranslation = useNoteTranslation(event.id)
  const displayEvent = useMemo(() => mergeTranslatedNote(event, noteTranslation), [event, noteTranslation])

  useLayoutEffect(() => {
    client.prefetchEmbeddedEventsForParents([event])
  }, [event.id])

  const reactionDisplay = useNotificationReactionDisplay(event)
  const webReactionParentUrl = useMemo(
    () =>
      event.kind === ExtendedKind.EXTERNAL_REACTION ? getWebExternalReactionTargetUrl(event) : undefined,
    [event]
  )

  const openHighlight = useCallback((data: HighlightData, eventContent?: string) => {
    setHighlightData(data)
    setHighlightDefaultContent(eventContent ?? '')
    setPublicMessageTo(null)
    setCallInviteContent(null)
    setPostEditorOpen(true)
  }, [])

  const openPublicMessage = useCallback((pubkey: string) => {
    setPublicMessageTo(pubkey)
    setCallInviteContent(null)
    setPostEditorOpen(true)
  }, [])

  const openCallInvite = useCallback((url: string) => {
    setCallInviteContent(url)
    setPublicMessageTo(null)
    setHighlightData(undefined)
    setHighlightDefaultContent('')
    setPostEditorOpen(true)
  }, [])

  const isHighlightableKind =
    event.kind === kinds.ShortTextNote ||
    event.kind === kinds.LongFormArticle ||
    event.kind === ExtendedKind.WIKI_ARTICLE ||
    event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
    event.kind === ExtendedKind.PUBLICATION ||
    event.kind === ExtendedKind.PUBLICATION_CONTENT ||
    event.kind === ExtendedKind.DISCUSSION ||
    isCalendarEventKind(event.kind) ||
    event.kind === ExtendedKind.COMMENT

  const renderEventContent = useCallback(
    ({
      hideMetadata = false,
      className = 'mt-2'
    }: {
      hideMetadata?: boolean
      className?: string
    } = {}) => {
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
        if (isNip18RepostKind(displayEvent.kind)) {
          return <RepostEventContent className={className} event={displayEvent} />
        }
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
      if (ASCIIDOC_CONTENT_KINDS.has(displayEvent.kind)) {
        return (
          <AsciidocArticle
            className={className}
            event={displayEvent}
            hideImagesAndInfo={hideMetadata}
          />
        )
      }
      if (
        nip84HighlightEvents?.length &&
        displayEvent.kind === kinds.ShortTextNote &&
        !shouldHideInteractions(displayEvent)
      ) {
        const merged = mergeNip84MarkedIntervals(
          displayEvent.content ?? '',
          nip84HighlightEvents,
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
        />
      )
    },
    [displayEvent, fullCalendarInvite, autoLoadMedia, nip84HighlightEvents, deferAuthorAvatar]
  )

  let content: React.ReactNode
  
  if (!isRenderableNoteKind(event.kind)) {
    content = <UnknownNote className="mt-2" event={displayEvent} omitKindLabel />
  } else if (muteSetHas(mutePubkeySet, event.pubkey) && !showMuted) {
    content = <MutedNote show={() => setShowMuted(true)} />
  } else if (!defaultShowNsfw && isNsfwEvent(event) && !showNsfw) {
    content = <NsfwNote show={() => setShowNsfw(true)} />
  } else if (isNip25ReactionKind(event.kind)) {
    content = null
  } else if (isNip18RepostKind(displayEvent.kind)) {
    content = <RepostEventContent className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.POLL_RESPONSE) {
    content = <NotificationEventCard className="mt-2" event={displayEvent} />
  } else if (event.kind === kinds.Highlights) {
    // Try to render the Highlight component with error boundary
    try {
      content = <Highlight className="mt-2" event={displayEvent} />
    } catch (error) {
      logger.error('Note component - Error rendering Highlight component:', error)
      content = <div className="mt-2 p-4 bg-red-100 border border-red-500 rounded">
        <div className="font-bold text-red-800">HIGHLIGHT ERROR:</div>
        <div className="text-red-700">Error: {String(error)}</div>
        <div className="mt-2">Content: {event.content}</div>
        <div>Context: {event.tags.find(tag => tag[0] === 'context')?.[1] || 'No context found'}</div>
      </div>
    }
  } else if (event.kind === ExtendedKind.WEB_BOOKMARK) {
    const href = getWebBookmarkArticleUrl(displayEvent)
    const title = displayEvent.tags.find((tag) => tag[0] === 'title')?.[1]?.trim()
    content = (
      <>
        {title ? (
          <h3 className="mt-2 text-base font-semibold leading-snug break-words">{title}</h3>
        ) : null}
        {href ? (
          <div className="mt-2 not-prose max-w-full space-y-2">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline break-all"
            >
              {href}
            </a>
            <WebPreview url={href} className="w-full" />
          </div>
        ) : null}
        {displayEvent.content?.trim() ? renderEventContent({ hideMetadata: true }) : null}
      </>
    )
  } else if (event.kind === ExtendedKind.WIKI_ARTICLE) {
    content = showFull ? (
      renderEventContent()
    ) : (
      <WikiCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
    content = showFull ? (
      renderEventContent()
    ) : (
      <WikiCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === ExtendedKind.PUBLICATION) {
    if (showFull) {
      const naddrFull = encodeArticleLikePublicationNaddr(displayEvent)
      content = (
        <div className="mt-2 space-y-3">
          <PublicationCard event={displayEvent} disableNavigation />
          {naddrFull ? (
            <Button
              type="button"
              size="lg"
              className="w-full font-semibold"
              onClick={(e) => {
                e.stopPropagation()
                openAlexandriaPublicationFromNaddr(naddrFull)
              }}
            >
              {t('View on Alexandria')}
            </Button>
          ) : null}
        </div>
      )
    } else {
      content = <PublicationCard className="mt-2" event={displayEvent} />
    }
  } else if (event.kind === ExtendedKind.PUBLICATION_CONTENT) {
    content = showFull ? (
      renderEventContent()
    ) : (
      <PublicationCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === kinds.LongFormArticle) {
    content = showFull ? (
      renderEventContent({ hideMetadata: true })
    ) : (
      <LongFormCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === kinds.LiveEvent || event.kind === 30312 || event.kind === 30313) {
    content = <LiveEvent className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.GROUP_METADATA) {
    content = <GroupMetadata className="mt-2" event={displayEvent} originalNoteId={originalNoteId} />
  } else if (event.kind === kinds.CommunityDefinition) {
    content = <CommunityDefinition className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.DISCUSSION) {
    const titleTag = displayEvent.tags.find(tag => tag[0] === 'title')
    const title = titleTag?.[1] || 'Untitled Discussion'
    content = (
      <>
        <h3 className="mt-2 text-lg font-semibold leading-tight break-words">{title}</h3>
        {renderEventContent({ hideMetadata: true })}
      </>
    )
  } else if (
    event.kind === ExtendedKind.CITATION_INTERNAL ||
    event.kind === ExtendedKind.CITATION_EXTERNAL ||
    event.kind === ExtendedKind.CITATION_HARDCOPY ||
    event.kind === ExtendedKind.CITATION_PROMPT
  ) {
    content = <CitationCard className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.POLL) {
    content = (
      <>
        {renderEventContent({ hideMetadata: true })}
        <Poll className="mt-2" event={displayEvent} eagerFetchResults={Boolean(embedded)} />
      </>
    )
  } else if (event.kind === ExtendedKind.ZAP_POLL) {
    content = (
      <>
        {renderEventContent({ hideMetadata: true })}
        <ZapPoll
          className="mt-2"
          event={displayEvent}
          voteHighlightOptionIndex={zapPollVoteHighlightOption}
        />
      </>
    )
  } else if (event.kind === ExtendedKind.VOICE) {
    content = <AudioPlayer className="mt-2" src={event.content} />
  } else if (event.kind === ExtendedKind.VOICE_COMMENT) {
    const voiceArticleUrl = getHttpUrlFromITags(event)
    content = (
      <>
        {voiceArticleUrl && (
          <div className="mt-2 not-prose max-w-full">
            <WebPreview url={voiceArticleUrl} className="w-full" />
          </div>
        )}
        <AudioPlayer className="mt-2" src={event.content} />
      </>
    )
  } else if (event.kind === ExtendedKind.PICTURE) {
    content = <PictureNote className="mt-2" event={event} />
  } else if (isNip71StyleVideoKind(event.kind)) {
    content = <VideoNote className="mt-2" event={event} loadMedia={showFull} />
  } else if (event.kind === ExtendedKind.RELAY_REVIEW) {
    content = <RelayReview className="mt-2" event={displayEvent} />
  } else if (isCalendarEventKind(event.kind)) {
    content = (
      <CalendarEventContent event={displayEvent} className="mt-2" showRsvp showFull={showFull} />
    )
  } else if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
    content = renderEventContent({ hideMetadata: true })
  } else if (event.kind === ExtendedKind.ZAP_REQUEST || event.kind === ExtendedKind.ZAP_RECEIPT) {
    content = <Zap className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.FOLLOW_PACK) {
    content = <FollowPackPreview className="mt-2" event={displayEvent} />
  } else if (
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT ||
    event.kind === ExtendedKind.GIT_ISSUE ||
    event.kind === ExtendedKind.GIT_RELEASE
  ) {
    content = <GitRepublicEventCard className="mt-2" event={displayEvent} />
  } else if (event.kind === kinds.ShortTextNote || event.kind === ExtendedKind.COMMENT) {
    content = renderEventContent({ hideMetadata: true })
  } else {
    content = renderEventContent()
  }

  const isSyntheticRssParent = isRssThreadSyntheticParentEvent(event)

  const wrappedContent = isHighlightableKind ? (
    <SelectionHighlightTrigger event={displayEvent}>{content}</SelectionHighlightTrigger>
  ) : (
    content
  )

  return (
    <CreateHighlightContext.Provider value={openHighlight}>
      <div
        className={`${className} ${disableClick ? '' : 'clickable'}`}
        onClick={disableClick ? undefined : (e) => {
          // Don't navigate if clicking on interactive elements
          const target = e.target as HTMLElement
          if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-embedded-note]') || target.closest('[data-parent-note-preview]') || target.closest('[data-user-avatar]') || target.closest('[data-username]')) {
            return
          }
          e.stopPropagation()
          client.addEventToCache(event)
          navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
        }}
      >
        <div className="flex flex-wrap justify-between items-start gap-2 min-w-0">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isNip25ReactionKind(event.kind) ? (
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
                {reactionDisplay.status === 'vote_up' ? (
                  <span
                    className={cn(
                      'inline-flex shrink-0 select-none leading-none',
                      size === 'small' ? 'text-xl' : 'text-2xl'
                    )}
                    aria-hidden
                  >
                    {DISCUSSION_UPVOTE_DISPLAY}
                  </span>
                ) : reactionDisplay.status === 'vote_down' ? (
                  <span
                    className={cn(
                      'inline-flex shrink-0 select-none leading-none',
                      size === 'small' ? 'text-xl' : 'text-2xl'
                    )}
                    aria-hidden
                  >
                    {DISCUSSION_DOWNVOTE_DISPLAY}
                  </span>
                ) : (
                  <ReactionEmojiDisplay event={event} />
                )}
                <UserAvatar
                  userId={event.pubkey}
                  size={size === 'small' ? 'medium' : 'normal'}
                  maxFileSizeKb={showFull ? 2048 : 500}
                  deferRemoteAvatar={deferAuthorAvatar}
                />
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
                  <Username
                    userId={event.pubkey}
                    className={`max-w-[min(12rem,40vw)] shrink font-semibold truncate ${size === 'small' ? 'text-sm' : ''}`}
                    skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
                  />
                  <ClientTag event={event} />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {t(notificationReactionSummaryKey(reactionDisplay))}
                  </span>
                </div>
                <FormattedTimestamp
                  timestamp={event.created_at}
                  className="shrink-0 text-sm text-muted-foreground"
                  short={isSmallScreen}
                />
              </div>
            ) : isSyntheticRssParent ? (
              <>
                <div
                  className={`shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center ${
                    size === 'small' ? 'w-9 h-9' : 'w-10 h-10'
                  }`}
                >
                  <img
                    src={publicAssetUrl('favicon.png')}
                    alt=""
                    className="w-full h-full object-cover"
                    width={size === 'small' ? 36 : 40}
                    height={size === 'small' ? 36 : 40}
                  />
                </div>
                <div className="flex-1 w-0">
                  <div className="flex gap-2 items-center">
                    <span
                      data-username
                      className={`font-semibold truncate text-foreground ${size === 'small' ? 'text-sm' : ''}`}
                    >
                      {t('Imwald synthetic event')}
                    </span>
                    <ClientTag event={event} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <UserAvatar
                  userId={event.pubkey}
                  size={size === 'small' ? 'medium' : 'normal'}
                  maxFileSizeKb={showFull ? 2048 : 500}
                  deferRemoteAvatar={deferAuthorAvatar}
                />
                <div className="flex-1 w-0">
                  <div className="flex gap-2 items-center">
                    <Username
                      userId={event.pubkey}
                      className={`font-semibold flex truncate ${size === 'small' ? 'text-sm' : ''}`}
                      skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
                    />
                    <ClientTag event={event} />
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Nip05 pubkey={event.pubkey} append="·" />
                    <FormattedTimestamp
                      timestamp={event.created_at}
                      className="shrink-0"
                      short={isSmallScreen}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {event.kind === ExtendedKind.DISCUSSION && (
              <button
                className="p-1 hover:bg-muted rounded transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  client.addEventToCache(event)
                  navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
                }}
                title="View in Discussions"
              >
                <MessageSquare className="w-4 h-4 text-blue-500" />
              </button>
            )}
            {(size === 'normal' ||
              event.kind === ExtendedKind.ZAP_REQUEST ||
              event.kind === ExtendedKind.ZAP_RECEIPT) && (
              <NoteOptions
                event={event}
                className={cn(
                  'py-1 shrink-0',
                  size === 'small' ? '[&_svg]:size-4' : '[&_svg]:size-5'
                )}
                initialHighlightData={highlightData}
                highlightDefaultContent={highlightDefaultContent}
                isPostEditorOpen={postEditorOpen}
                onPostEditorClose={() => {
                  setPostEditorOpen(false)
                  setHighlightData(undefined)
                  setHighlightDefaultContent('')
                  setPublicMessageTo(null)
                  setCallInviteContent(null)
                }}
                onOpenPublicMessage={openPublicMessage}
                initialPublicMessageTo={publicMessageTo}
                onOpenCallInvite={openCallInvite}
                initialDefaultContent={callInviteContent}
              />
            )}
          </div>
        </div>
        <NoteKindLabel kind={event.kind} event={event} size={size} className="mt-1" />
        {webReactionParentUrl ? (
          <div className="mt-2 not-prose max-w-full" data-parent-note-preview>
            <WebPreview url={webReactionParentUrl} className="w-full" />
          </div>
        ) : parentEventId ? (
          <ParentNotePreview
            eventId={parentEventId}
            relayHints={parentFetchRelayHints}
            className="mt-2"
            onClick={(e) => {
              e.stopPropagation()
              const parentEv = client.peekSessionCachedEvent(parentEventId)
              navigateToNote(
                toNote(parentEventId),
                parentEv,
                parentEv ? getCachedThreadContextEvents(parentEv) : undefined
              )
            }}
          />
        ) : null}
        <IValue event={event} className="mt-2" />
        {wrappedContent}
      </div>
    </CreateHighlightContext.Provider>
  )
}
