import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { useSmartNoteNavigation } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { getMoneroTipInfo } from '@/lib/monero-tip'
import { isMentioningMutedUsers, isNip18RepostKind, isNip25ReactionKind } from '@/lib/event'
import { getWebExternalReactionTargetUrl } from '@/lib/rss-article'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Collapsible from '../Collapsible'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'
import ReactionEmojiDisplay from '../Note/ReactionEmojiDisplay'
import NoteAuthorMetaLine from '../NoteAuthorMetaLine'
import NoteOptions from '../NoteOptions'
import NoteStats from '../NoteStats'
import ParentNotePreview from '../ParentNotePreview'
import WebPreview from '../WebPreview'
import UserAvatar from '../UserAvatar'
import Superchat from '../Note/Superchat'
import Zap from '../Note/Zap'
import MoneroTip from '../Note/MoneroTip'

export default function ReplyNote({
  event,
  parentEventId,
  onClickParent = () => {},
  onClickReply,
  highlight = false,
  duplicateWebPreviewCleanedUrlHints,
  foregroundStats = false
}: {
  event: Event
  parentEventId?: string
  onClickParent?: () => void
  onClickReply?: (event: Event) => void
  highlight?: boolean
  duplicateWebPreviewCleanedUrlHints?: string[]
  foregroundStats?: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { navigateToNote } = useSmartNoteNavigation()
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [showMuted, setShowMuted] = useState(false)
  const reactionDisplay = useNotificationReactionDisplay(event)
  const webReactionParentUrl = useMemo(
    () =>
      event.kind === ExtendedKind.EXTERNAL_REACTION ? getWebExternalReactionTargetUrl(event) : undefined,
    [event]
  )
  const parentFetchRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const headerUserId = useMemo(() => {
    if (event.kind === kinds.Zap) {
      const info = getZapInfoFromEvent(event)
      return info?.senderPubkey ?? event.pubkey
    }
    if (
      event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
      event.kind === ExtendedKind.MONERO_TIP_RECEIPT
    ) {
      const info = getMoneroTipInfo(event)
      return info?.senderPubkey ?? event.pubkey
    }
    return event.pubkey
  }, [event])

  const show = useMemo(() => {
    if (showMuted) {
      return true
    }
    if (muteSetHas(mutePubkeySet, event.pubkey)) {
      return false
    }
    if (hideContentMentioningMutedUsers && isMentioningMutedUsers(event, mutePubkeySet)) {
      return false
    }
    return true
  }, [showMuted, mutePubkeySet, event, hideContentMentioningMutedUsers])

  return (
    <div
      className={`clickable border-b pb-3 transition-colors duration-500 ${highlight ? 'bg-primary/50' : ''}`}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-parent-note-preview]')) {
          return
        }
        if (onClickReply) {
          onClickReply(event)
        } else {
          navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
        }
      }}
    >
      <Collapsible>
        <div className="px-4 pt-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <UserAvatar
                userId={headerUserId}
                size="medium"
                className="mt-0.5 shrink-0"
                maxFileSizeKb={2048}
                deferRemoteAvatar={false}
              />
              <NoteAuthorMetaLine
                userId={headerUserId}
                timestamp={event.created_at}
                powEvent={event}
                usernameClassName="max-w-[min(12rem,40vw)] text-sm text-muted-foreground hover:text-foreground"
                skeletonClassName="h-3"
                timestampShort={isSmallScreen}
              />
            </div>
            <NoteOptions event={event} className="shrink-0 [&_svg]:size-5" />
          </div>
          {webReactionParentUrl ? (
            <div className="not-prose mt-1.5 max-w-full" data-parent-note-preview>
              <WebPreview url={webReactionParentUrl} className="w-full" />
            </div>
          ) : parentEventId &&
            event.kind !== kinds.Zap &&
            event.kind !== ExtendedKind.PAYMENT_NOTIFICATION &&
            event.kind !== ExtendedKind.ZAP_RECEIPT &&
            event.kind !== ExtendedKind.MONERO_TIP_DISCLOSURE &&
            event.kind !== ExtendedKind.MONERO_TIP_RECEIPT ? (
            <ParentNotePreview
              appearance="subtle"
              className="mt-1.5"
              eventId={parentEventId}
              relayHints={parentFetchRelayHints}
              onClick={(e) => {
                e.stopPropagation()
                onClickParent()
              }}
            />
          ) : null}
          {show ? (
            isNip25ReactionKind(event.kind) ? (
              <div
                className={cn(
                  'mt-2 flex min-h-0 min-w-0 flex-wrap items-end gap-x-2 gap-y-1 overflow-visible pb-1.5',
                  reactionDisplay.status === 'default'
                    ? 'text-foreground'
                    : 'text-muted-foreground text-sm'
                )}
              >
                {reactionDisplay.status === 'vote_up' ? (
                  <span className="text-sm leading-none opacity-90" aria-hidden>
                    {DISCUSSION_UPVOTE_DISPLAY}
                  </span>
                ) : reactionDisplay.status === 'vote_down' ? (
                  <span className="text-sm leading-none opacity-90" aria-hidden>
                    {DISCUSSION_DOWNVOTE_DISPLAY}
                  </span>
                ) : (
                  <ReactionEmojiDisplay event={event} variant="thread" maxRawLength={64} />
                )}
                {reactionDisplay.status !== 'default' && (
                  <span className="text-sm text-foreground/85">{t(notificationReactionSummaryKey(reactionDisplay))}</span>
                )}
              </div>
            ) : event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT ? (
              <Zap className="mt-1.5" event={event} variant="thread" />
            ) : event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
              event.kind === ExtendedKind.MONERO_TIP_RECEIPT ? (
              <MoneroTip className="mt-1.5" event={event} variant="thread" />
            ) : event.kind === ExtendedKind.PAYMENT_NOTIFICATION ? (
              <Superchat className="mt-1.5" event={event} variant="thread" />
            ) : isNip18RepostKind(event.kind) ? null : (
              <MarkdownArticle
                className="mt-2"
                event={event}
                hideMetadata={true}
                lazyMedia={false}
                duplicateWebPreviewCleanedUrlHints={duplicateWebPreviewCleanedUrlHints}
              />
            )
          ) : (
            <Button
              variant="outline"
              className="mt-2 font-medium text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setShowMuted(true)
              }}
            >
              {t('Temporarily display this reply')}
            </Button>
          )}
        </div>
      </Collapsible>
      {show && !isNip18RepostKind(event.kind) && (
        <NoteStats
          className="mt-2 px-4"
          event={event}
          fetchIfNotExisting
          foregroundStats={foregroundStats}
          useIconOnlyLikeTrigger={isNip25ReactionKind(event.kind)}
        />
      )}
    </div>
  )
}

export function ReplyNoteSkeleton() {
  return (
    <div className="w-full px-4 py-3">
      <div className="flex items-start gap-2">
        <Skeleton className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  )
}
