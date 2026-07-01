import { useSmartNoteNavigationOptional } from '@/PageManager'
import { getContentWarningLabel } from '@/lib/content-warning'
import { ExtendedKind, publicAssetUrl } from '@/constants'
import { isHighlightableKind as isRegistryHighlightableKind } from '@/lib/kind-registry/registry'
import { KindEventBody } from '@/lib/kind-registry/render'
import { deriveSurface, type RenderCtx } from '@/lib/kind-registry/types'
import {
  getParentBech32Id,
  isNip25ReactionKind,
  isNsfwEvent
} from '@/lib/event'
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
import client from '@/services/client.service'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { Event, kinds } from 'nostr-tools'
import { mergeTranslatedNote, useNoteTranslation } from '@/lib/note-translation-display'
import { mergeEditedShortNote } from '@/lib/short-note-edits'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getWebExternalReactionTargetUrl, isRssThreadSyntheticParentEvent } from '@/lib/rss-article'
import { CreateHighlightContext } from './CreateHighlightContext'
import SelectionHighlightTrigger from './SelectionHighlightTrigger'
import { HttpUrlOpenGraphOrLink } from '../Embedded'
import NoteAuthorMetaLine from '../NoteAuthorMetaLine'
import ShortNoteEditIndicator from './ShortNoteEditIndicator'
import { FormattedTimestamp } from '../FormattedTimestamp'
import NoteOptions from '../NoteOptions'
import EventPowLabel from '../EventPowLabel'
import ParentNotePreview from '../ParentNotePreview'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import { MessageSquare } from 'lucide-react'
import IValue from './IValue'
import MutedNote from './MutedNote'
import NsfwNote from './NsfwNote'
import ReactionEmojiDisplay from './ReactionEmojiDisplay'
import PostEditor from '../PostEditor/LazyPostEditor'
import { openComposerAfterOverlay } from '../PostEditor/open-composer-after-overlay'

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

  const isHighlightableKind = isRegistryHighlightableKind(event.kind)

  const renderCtx: RenderCtx = useMemo(
    () => ({
      event,
      displayEvent,
      surface: deriveSurface({ embedded, showFull }),
      showFull: !!showFull,
      embedded,
      autoLoadMedia,
      fullCalendarInvite,
      nip84HighlightEvents,
      deferAuthorAvatar,
      hidePollOptions,
      showPaymentAttestationAction,
      originalNoteId
    }),
    [
      event,
      displayEvent,
      embedded,
      showFull,
      autoLoadMedia,
      fullCalendarInvite,
      nip84HighlightEvents,
      deferAuthorAvatar,
      hidePollOptions,
      showPaymentAttestationAction,
      originalNoteId
    ]
  )

  const bodyCtx: RenderCtx = useMemo(
    () => ({
      ...renderCtx,
      isShortNoteEdited,
      shortNoteEditOriginalContent: event.content,
      shortNoteEditRevisedContent: shortNoteEditState?.latestAuthorEdit?.content
    }),
    [renderCtx, isShortNoteEdited, event.content, shortNoteEditState?.latestAuthorEdit?.content]
  )

  let content: React.ReactNode

  if (muteSetHas(mutePubkeySet, event.pubkey) && !showMuted) {
    content = <MutedNote show={() => setShowMuted(true)} />
  } else if (!defaultShowNsfw && isNsfwEvent(event) && !showNsfw) {
    content = <NsfwNote show={() => setShowNsfw(true)} label={getContentWarningLabel(event)} />
  } else if (isNip25ReactionKind(event.kind)) {
    content = null
  } else {
    content = <KindEventBody {...bodyCtx} />
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
