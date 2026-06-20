import { useSmartNoteNavigationOptional } from '@/PageManager'
import { getContentWarningLabel } from '@/lib/content-warning'
import { ExtendedKind, isMusicTrackKind, isNip71StyleVideoKind, publicAssetUrl } from '@/constants'
import { isRenderableNoteKind } from '@/lib/note-renderable-kinds'
import {
  getHttpUrlFromITags,
  getParentBech32Id,
  isNip18RepostKind,
  isNip25ReactionKind,
  isNsfwEvent
} from '@/lib/event'
import { mergeNip84MarkedIntervals, renderPlaintextWithNip84MergedMarks } from '@/lib/nip84-op-body-marks'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { toNote } from '@/lib/link'
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
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { Event, kinds } from 'nostr-tools'
import { isCalendarEventKind } from '@/lib/calendar-event'
import { mergeTranslatedNote, useNoteTranslation } from '@/lib/note-translation-display'
import { mergeEditedShortNote } from '@/lib/short-note-edits'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getWebBookmarkReplaceableEventNaddr } from '@/lib/web-bookmark-nip'
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
import { EmbeddedNote } from '../Embedded'
import { HttpUrlOpenGraphOrLink } from '../Embedded'
import NoteAuthorMetaLine from '../NoteAuthorMetaLine'
import ShortNoteEditIndicator from './ShortNoteEditIndicator'
import ShortNoteEditedContent from './ShortNoteEditedContent'
import { FormattedTimestamp } from '../FormattedTimestamp'
import NoteOptions from '../NoteOptions'
import EventPowLabel from '../EventPowLabel'
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
import PublicationCard from './PublicationCard'
import PublicationIndexMetadata from './PublicationIndexMetadata'
import NostrSpecCard from './NostrSpecCard'
import WikiCard from './WikiCard'
import LongFormCard from './LongFormCard'
import MutedNote from './MutedNote'
import NsfwNote from './NsfwNote'
import PictureNote from './PictureNote'
import Poll from './Poll'
import NotificationEventCard from './NotificationEventCard'
import ReactionEmojiDisplay from './ReactionEmojiDisplay'
import UnknownNote from './UnknownNote'
import VideoNote from './VideoNote'
import MusicTrackNote from './MusicTrackNote'
import RelayReview from './RelayReview'
import Superchat from './Superchat'
import Zap from './Zap'
import MoneroTip from './MoneroTip'
import CitationCard from '@/components/CitationCard'
import FollowPackPreview from '../ContentPreview/FollowPackPreview'
import CalendarEventContent from '../CalendarEventContent'
import GitRepublicEventCard from './GitRepublicEventCard'
import LearningResourceCard from './LearningResourceCard'
import MarkdownArticle from './LazyMarkdownArticle'
import AsciidocArticle from './LazyAsciidocArticle'
import PostEditor from '../PostEditor/LazyPostEditor'
import { openComposerAfterOverlay } from '../PostEditor/open-composer-after-overlay'

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
  nip84HighlightEvents,
  deferAuthorAvatar = false,
  /** When true, parent list already prefetches embeds — skip per-row duplicate fetches. */
  skipEmbedPrefetch = false,
  hidePollOptions = false,
  showPaymentAttestationAction = false,
  pinned = false,
  seenOnAllowlist
}: {
  event: Event
  originalNoteId?: string
  size?: 'normal' | 'small'
  className?: string
  hideParentNotePreview?: boolean
  showFull?: boolean
  disableClick?: boolean
  embedded?: boolean
  /** Passed to note menu when this row is already shown as pinned. */
  pinned?: boolean
  /** When viewing a kind-24 invite, use this to replace the embedded calendar with the full card (RSVP) in content */
  fullCalendarInvite?: { event: Event; naddr: string }
  /** Kind-9802 events that cite this note; when spans match {@link displayEvent.content}, render green marks (note page OP). */
  nip84HighlightEvents?: Event[]
  /** When true, defer remote profile avatars until near-viewport (dense lists e.g. merged NIP-50 search). */
  deferAuthorAvatar?: boolean
  /** Skip embedded-note prefetch when the feed list handles it in batch. */
  skipEmbedPrefetch?: boolean
  /** Thread context above a reply: poll question only, no option rows or vote controls. */
  hidePollOptions?: boolean
  /** Notifications feed: show attest-superchat action on incoming payments. */
  showPaymentAttestationAction?: boolean
  /** When set (home favorites feed), relay list in ⋯ menu matches the feed allowlist. */
  seenOnAllowlist?: readonly string[]
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const parentEventId = useMemo(() => {
    if (hideParentNotePreview) return undefined
    if (
      event.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
      event.kind === ExtendedKind.ZAP_RECEIPT ||
      event.kind === ExtendedKind.ZAP_REQUEST ||
      event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
      event.kind === ExtendedKind.MONERO_TIP_RECEIPT
    ) {
      return undefined
    }
    return getParentBech32Id(event)
  }, [event, hideParentNotePreview])
  const parentFetchRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const contentPolicy = useContentPolicyOptional()
  const defaultShowNsfw = contentPolicy?.defaultShowNsfw ?? true
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const [showNsfw, setShowNsfw] = useState(false)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const [showMuted, setShowMuted] = useState(false)
  const [highlightData, setHighlightData] = useState<HighlightData | undefined>(undefined)
  const [highlightDefaultContent, setHighlightDefaultContent] = useState<string>('')
  const [postEditorOpen, setPostEditorOpen] = useState(false)
  const [postEditorMounted, setPostEditorMounted] = useState(false)
  const [publicMessageTo, setPublicMessageTo] = useState<string | null>(null)
  const [callInviteContent, setCallInviteContent] = useState<string | null>(null)
  const noteTranslation = useNoteTranslation(event.id)
  const shortNoteEditState = useShortNoteEdits(event.kind === kinds.ShortTextNote ? event : undefined)
  const displayEvent = useMemo(() => {
    let base = event
    if (event.kind === kinds.ShortTextNote && shortNoteEditState?.latestAuthorEdit) {
      base = mergeEditedShortNote(event, shortNoteEditState.latestAuthorEdit)
    }
    return mergeTranslatedNote(base, noteTranslation)
  }, [event, noteTranslation, shortNoteEditState?.latestAuthorEdit])
  const isShortNoteEdited =
    event.kind === kinds.ShortTextNote &&
    !!shortNoteEditState?.latestAuthorEdit &&
    shortNoteEditState.latestAuthorEdit.content !== event.content

  useLayoutEffect(() => {
    if (skipEmbedPrefetch) return
    client.prefetchEmbeddedEventsForParents([event])
  }, [event.id, skipEmbedPrefetch])

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
    setPostEditorMounted(true)
    // Defer until the selection drawer has closed (avoids vaul/Radix sheet fighting on mobile).
    requestAnimationFrame(() => {
      setPostEditorOpen(true)
    })
  }, [])

  const mountComposerThenOpen = useCallback(() => {
    setPostEditorMounted(true)
    openComposerAfterOverlay(setPostEditorOpen)
  }, [])

  const openPublicMessage = useCallback((pubkey: string) => {
    setHighlightData(undefined)
    setHighlightDefaultContent('')
    setPublicMessageTo(pubkey)
    setCallInviteContent(null)
    mountComposerThenOpen()
  }, [mountComposerThenOpen])

  const openCallInvite = useCallback((url: string) => {
    setCallInviteContent(url)
    setPublicMessageTo(null)
    setHighlightData(undefined)
    setHighlightDefaultContent('')
    mountComposerThenOpen()
  }, [mountComposerThenOpen])

  const isHighlightableKind =
    event.kind === kinds.ShortTextNote ||
    event.kind === kinds.LongFormArticle ||
    event.kind === ExtendedKind.WIKI_ARTICLE ||
    event.kind === ExtendedKind.NOSTR_SPECIFICATION ||
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
        displayEvent.kind === kinds.ShortTextNote
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
      if (
        event.kind === kinds.ShortTextNote &&
        isShortNoteEdited &&
        shortNoteEditState?.latestAuthorEdit
      ) {
        return (
          <ShortNoteEditedContent
            original={event.content}
            revised={shortNoteEditState.latestAuthorEdit.content}
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
        />
      )
    },
    [
      displayEvent,
      event,
      fullCalendarInvite,
      autoLoadMedia,
      nip84HighlightEvents,
      deferAuthorAvatar,
      isShortNoteEdited,
      shortNoteEditState?.latestAuthorEdit
    ]
  )

  let content: React.ReactNode
  
  if (!isRenderableNoteKind(event.kind)) {
    content = <UnknownNote className="mt-2" event={displayEvent} omitKindLabel />
  } else if (muteSetHas(mutePubkeySet, event.pubkey) && !showMuted) {
    content = <MutedNote show={() => setShowMuted(true)} />
  } else if (!defaultShowNsfw && isNsfwEvent(event) && !showNsfw) {
    content = <NsfwNote show={() => setShowNsfw(true)} label={getContentWarningLabel(event)} />
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
    const embeddedNaddr = getWebBookmarkReplaceableEventNaddr(displayEvent)
    const href = getWebBookmarkArticleUrl(displayEvent)
    const title = displayEvent.tags.find((tag) => tag[0] === 'title')?.[1]?.trim()
    const description = displayEvent.content?.trim()
    content = (
      <>
        {title ? (
          <h3 className="mt-2 text-base font-semibold leading-snug break-words">{title}</h3>
        ) : null}
        {embeddedNaddr ? (
          <EmbeddedNote
            noteId={embeddedNaddr}
            className="mt-2"
            containingEvent={event}
            showFull={false}
          />
        ) : href ? (
          <div className="mt-2 not-prose max-w-full">
            <HttpUrlOpenGraphOrLink url={href} containingEvent={event} block className="w-full" />
          </div>
        ) : null}
        {description ? (
          <p className="mt-2 text-base whitespace-pre-wrap break-words">{description}</p>
        ) : null}
      </>
    )
  } else if (event.kind === ExtendedKind.WIKI_ARTICLE) {
    content = showFull ? (
      renderEventContent()
    ) : (
      <WikiCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === ExtendedKind.NOSTR_SPECIFICATION) {
    content = showFull ? (
      renderEventContent()
    ) : (
      <NostrSpecCard className="mt-2" event={displayEvent} />
    )
  } else if (event.kind === ExtendedKind.PUBLICATION) {
    if (showFull) {
      content = <PublicationIndexMetadata className="mt-2" event={displayEvent} variant="full" />
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
        <Poll
          className="mt-2"
          event={displayEvent}
          eagerFetchResults={Boolean(embedded)}
          hidePollOptions={hidePollOptions}
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
            <HttpUrlOpenGraphOrLink url={voiceArticleUrl} containingEvent={event} block className="w-full" />
          </div>
        )}
        <AudioPlayer className="mt-2" src={event.content} />
      </>
    )
  } else if (event.kind === ExtendedKind.PICTURE) {
    content = <PictureNote className="mt-2" event={event} />
  } else if (isMusicTrackKind(event.kind)) {
    content = <MusicTrackNote className="mt-2" event={event} loadMedia={showFull} />
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
  } else if (
    event.kind === ExtendedKind.ZAP_REQUEST ||
    event.kind === ExtendedKind.ZAP_RECEIPT ||
    event.kind === kinds.Zap
  ) {
    content = (
      <Zap
        className="mt-2"
        event={displayEvent}
        variant={showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  } else if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    content = (
      <Superchat
        className="mt-2"
        event={displayEvent}
        variant={showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  } else if (
    event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
    event.kind === ExtendedKind.MONERO_TIP_RECEIPT
  ) {
    content = (
      <MoneroTip
        className="mt-2"
        event={displayEvent}
        variant={showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  } else if (event.kind === ExtendedKind.FOLLOW_PACK) {
    content = <FollowPackPreview className="mt-2" event={displayEvent} />
  } else if (
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT ||
    event.kind === ExtendedKind.GIT_ISSUE ||
    event.kind === ExtendedKind.GIT_RELEASE
  ) {
    content = <GitRepublicEventCard className="mt-2" event={displayEvent} />
  } else if (event.kind === ExtendedKind.LEARNING_RESOURCE) {
    content = <LearningResourceCard className="mt-2" event={displayEvent} />
  } else if (event.kind === kinds.ShortTextNote || event.kind === ExtendedKind.COMMENT) {
    content = renderEventContent({ hideMetadata: true })
  } else {
    content = renderEventContent()
  }

  const isSyntheticRssParent = isRssThreadSyntheticParentEvent(event)

  return (
    <CreateHighlightContext.Provider value={openHighlight}>
      <div
        className={`${className} ${disableClick ? '' : 'clickable'}`}
        onClick={disableClick ? undefined : (e) => {
          // Don't navigate if clicking on interactive elements
          const target = e.target as HTMLElement
          if (window.getSelection()?.toString().trim()) {
            return
          }
          if (
            target.closest('button') ||
            target.closest('[role="button"]') ||
            target.closest('a') ||
            target.closest('[data-embedded-note]') ||
            target.closest('[data-parent-note-preview]') ||
            target.closest('[data-user-avatar]') ||
            target.closest('[data-username]') ||
            target.closest('[data-selection-highlight-ui]') ||
            target.closest('.highlight-button-container')
          ) {
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
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {t(notificationReactionSummaryKey(reactionDisplay))}
                  </span>
                </div>
                <FormattedTimestamp
                  timestamp={event.created_at}
                  className="shrink-0 text-sm text-muted-foreground"
                  short={isSmallScreen}
                />
                <EventPowLabel event={event} />
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
                <NoteAuthorMetaLine
                  userId={event.pubkey}
                  timestamp={event.created_at}
                  powEvent={event}
                  usernameClassName={
                    size === 'small'
                      ? 'max-w-[min(12rem,40vw)] text-sm'
                      : 'max-w-[min(16rem,50vw)]'
                  }
                  skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
                  timestampShort={isSmallScreen}
                />
                {event.kind === kinds.ShortTextNote ? (
                  <ShortNoteEditIndicator
                    originalEvent={event}
                    editState={shortNoteEditState}
                    timestampShort={isSmallScreen}
                  />
                ) : null}
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
                pinned={pinned}
                seenOnAllowlist={seenOnAllowlist}
                className={cn(
                  'py-1 shrink-0',
                  size === 'small' ? '[&_svg]:size-4' : '[&_svg]:size-5'
                )}
                onOpenPublicMessage={openPublicMessage}
                onOpenCallInvite={openCallInvite}
              />
            )}
          </div>
        </div>
        {webReactionParentUrl ? (
          <div className="mt-2 not-prose max-w-full" data-parent-note-preview>
            <HttpUrlOpenGraphOrLink url={webReactionParentUrl} containingEvent={event} block className="w-full" />
          </div>
        ) : parentEventId ? (
          <ParentNotePreview
            eventId={parentEventId}
            replyContext={event}
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
        {isHighlightableKind ? (
          <SelectionHighlightTrigger event={displayEvent} openHighlight={openHighlight}>
            {content}
          </SelectionHighlightTrigger>
        ) : (
          content
        )}
      </div>
      {postEditorMounted ? (
        <PostEditor
          open={postEditorOpen}
          setOpen={(open) => {
            setPostEditorOpen(open)
            if (!open) {
              setHighlightData(undefined)
              setHighlightDefaultContent('')
              setPublicMessageTo(null)
              setCallInviteContent(null)
            }
          }}
          defaultContent={callInviteContent ?? highlightDefaultContent}
          initialHighlightData={highlightData}
          initialPublicMessageTo={publicMessageTo ?? undefined}
        />
      ) : null}
    </CreateHighlightContext.Provider>
  )
}
