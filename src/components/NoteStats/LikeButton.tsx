import storage from '@/services/local-storage.service'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useReplyUnderDiscussionRoot } from '@/hooks/useReplyUnderDiscussionRoot'
import { createDeletionRequestDraftEvent, createReactionDraftEvent } from '@/lib/draft-event'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY,
  DISCUSSION_VOTE_EMOJIS,
  discussionVoteMatches,
  isDiscussionDownvoteEmoji,
  isDiscussionUpvoteEmoji,
  isDiscussionVoteEmoji
} from '@/lib/discussion-votes'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useSignGatedControl } from '@/hooks/useSignGatedControl'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { eventService } from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import type { TNoteStats } from '@/services/note-stats.service'
import { TEmoji } from '@/types'
import { SmilePlus } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import logger from '@/lib/logger'
import { useTranslation } from 'react-i18next'
import Emoji, { EMOJI_IMG_INLINE_CLASS } from '../Emoji'
import EmojiPicker, { EMOJI_PICKER_REACTIONS } from '../EmojiPicker'
import { DiscussionVoteCountHover, ReactionCountHover } from './NoteStatsCountHover'
import {
  type RelayStatus,
  showPublishingError,
  showPublishingFeedback,
  showSimplePublishSuccess
} from '@/lib/publishing-feedback'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { cn } from '@/lib/utils'
import { WEB_EXTERNAL_REACTION_PUBLISHED_EVENT } from '@/lib/rss-web-feed'

type LikeButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
  isReplyToDiscussion?: boolean
  /** When true, never show the user's last reaction emoji in the trigger (icon + count only). */
  useIconOnlyLikeTrigger?: boolean
}

export function LikeButtonWithStats({
  event,
  hideCount = false,
  noteStats,
  isReplyToDiscussion: isReplyToDiscussionProp,
  useIconOnlyLikeTrigger = false
}: LikeButtonProps) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, publish, checkLogin } = useNostr()
  const { canSignEvents, signControlProps } = useSignGatedControl()
  const { relays: statsRelays } = useNoteStatsRelayHints()
  const [liking, setLiking] = useState(false)
  const [isEmojiReactionsOpen, setIsEmojiReactionsOpen] = useState(false)
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const isReplyToDiscussion = isReplyToDiscussionProp ?? false
  const showDiscussionVotes = isDiscussion || isReplyToDiscussion

  const statsLoaded = noteStats?.updatedAt != null

  const { myLastEmoji, likeCount, upVoteCount, downVoteCount } = useMemo(() => {
    const stats = noteStats || {}
    const likes = stats.likes

    const myLike = likes?.find((like) => {
      if (like.pubkey !== pubkey) return false
      if (showDiscussionVotes) return isDiscussionVoteEmoji(like.emoji)
      return true
    })

    let upVoteCount = 0
    let downVoteCount = 0
    if (showDiscussionVotes) {
      upVoteCount = likes?.filter((like) => isDiscussionUpvoteEmoji(like.emoji)).length || 0
      downVoteCount = likes?.filter((like) => isDiscussionDownvoteEmoji(like.emoji)).length || 0
    }

    return {
      myLastEmoji: myLike?.emoji,
      likeCount: likes?.length,
      upVoteCount,
      downVoteCount
    }
  }, [noteStats, pubkey, showDiscussionVotes])

  /** Same idea as {@link ReplyButton}: merged likes (thread fetch / publish) can exist before snapshot sets `updatedAt`. */
  const showLikeCount = !hideCount && (statsLoaded || (likeCount ?? 0) > 0)

  const like = async (emoji: string | TEmoji) => {
    checkLogin(async () => {
      if (liking || !pubkey) return

      setLiking(true)
      const timer = setTimeout(() => setLiking(false), 10_000)

      try {
        if (!noteStats?.updatedAt) {
          await noteStatsService.fetchNoteStats(event, pubkey, statsRelays, { foreground: true })
        }

        const emojiString = typeof emoji === 'string' ? emoji : emoji.shortcode
        const myLastEmojiString =
          typeof myLastEmoji === 'string'
            ? myLastEmoji
            : typeof myLastEmoji === 'object'
              ? myLastEmoji.shortcode
              : undefined
        const isTogglingOff = showDiscussionVotes
          ? discussionVoteMatches(myLastEmoji, emoji)
          : myLastEmojiString === emojiString

        logger.debug('Like toggle check', {
          myLastEmoji,
          myLastEmojiString,
          emojiString,
          isTogglingOff,
          myLikes: noteStats?.likes?.filter(like => like.pubkey === pubkey)
        })

        if (isTogglingOff) {
          // User wants to toggle off - find their previous reaction and delete it
          const myReaction = noteStats?.likes?.find((like) => {
            if (like.pubkey !== pubkey) return false
            if (showDiscussionVotes) return discussionVoteMatches(like.emoji, emoji)
            const likeEmojiString = typeof like.emoji === 'string' ? like.emoji : like.emoji.shortcode
            return likeEmojiString === emojiString
          })
          
          if (myReaction) {
            // Optimistically update the UI immediately
            noteStatsService.removeLike(event.id, myReaction.id)
            
            // Fetch the actual reaction event
            const reactionEvent = await eventService.fetchEvent(myReaction.id)
            if (reactionEvent) {
              // Create and publish a deletion request (kind 5)
              const deletionRequest = createDeletionRequestDraftEvent(reactionEvent)
              const deletedEvent = await publish(deletionRequest, {
                addClientTag: storage.getAddClientTag()
              })
              
              // Show publishing feedback
              if ((deletedEvent as any)?.relayStatuses) {
                showPublishingFeedback({
                  success: true,
                  relayStatuses: (deletedEvent as any).relayStatuses,
                  successCount: (deletedEvent as any).relayStatuses.filter((s: any) => s.success).length,
                  totalCount: (deletedEvent as any).relayStatuses.length
                }, {
                  message: t('Reaction removed'),
                  duration: 4000
                })
              } else {
                showSimplePublishSuccess(t('Reaction removed'))
              }
              if (
                event.kind === ExtendedKind.RSS_THREAD_ROOT &&
                reactionEvent?.kind === ExtendedKind.EXTERNAL_REACTION
              ) {
                window.dispatchEvent(new CustomEvent(WEB_EXTERNAL_REACTION_PUBLISHED_EVENT))
              }
            }
          }
        } else {
          // User is adding a new reaction
          const reaction = createReactionDraftEvent(event, emoji)
          const evt = await publish(reaction, { addClientTag: storage.getAddClientTag() })
          
          // Show publishing feedback
          if ((evt as any)?.relayStatuses) {
            showPublishingFeedback({
              success: true,
              relayStatuses: (evt as any).relayStatuses,
              successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
              totalCount: (evt as any).relayStatuses.length
            }, {
              message: t('Reaction published'),
              duration: 4000
            })
          } else {
            showSimplePublishSuccess(t('Reaction published'))
          }
          
          noteStatsService.updateNoteStatsByEvents([evt], undefined, {
            interactionTargetNoteId: event.id
          })
          if (event.kind === ExtendedKind.RSS_THREAD_ROOT && evt.kind === ExtendedKind.EXTERNAL_REACTION) {
            window.dispatchEvent(new CustomEvent(WEB_EXTERNAL_REACTION_PUBLISHED_EVENT))
          }
        }
      } catch (error) {
        if (error instanceof LoginRequiredError) {
          return
        }
        logger.error('Like failed', { error, eventId: event.id })
        if (error instanceof AggregateError && (error as AggregateError & { relayStatuses?: RelayStatus[] }).relayStatuses) {
          const relayStatuses = (error as AggregateError & { relayStatuses: RelayStatus[] }).relayStatuses
          const successCount = relayStatuses.filter((s) => s.success).length
          showPublishingFeedback(
            {
              success: successCount > 0,
              relayStatuses,
              successCount,
              totalCount: relayStatuses.length
            },
            {
              message:
                successCount > 0 ? t('Reaction published to some relays') : t('Failed to publish reaction'),
              duration: 6000
            }
          )
        } else {
          showPublishingError(error instanceof Error ? error.message : t('Failed to publish reaction'))
        }
      } finally {
        setLiking(false)
        clearTimeout(timer)
      }
    })
  }

  const openReactionPicker = () => {
    if (!canSignEvents) return
    if (myLastEmoji && !isEmojiReactionsOpen) {
      like(myLastEmoji)
      return
    }
    setIsEmojiReactionsOpen(true)
  }

  const likeIconButton = (
    <button
      type="button"
      className="flex h-full min-w-0 items-center gap-1.5 px-2 text-muted-foreground enabled:hover:text-primary touch-manipulation"
      {...signControlProps({ title: t('Like'), disabled: liking })}
      onClick={openReactionPicker}
    >
      {liking ? (
        <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden />
      ) : myLastEmoji && !useIconOnlyLikeTrigger ? (
        <Emoji emoji={myLastEmoji} classNames={{ img: EMOJI_IMG_INLINE_CLASS }} />
      ) : (
        <SmilePlus />
      )}
    </button>
  )

  const likeCountLabel = showLikeCount ? (
    <ReactionCountHover noteStats={noteStats}>
      <div className="pr-1 text-sm tabular-nums">
        {(likeCount ?? 0) >= 100 ? '99+' : String(likeCount ?? 0)}
      </div>
    </ReactionCountHover>
  ) : (
    <span className="pr-1" aria-hidden />
  )

  // Discussions (kind 11) and kind 1111 under a discussion: only +/- vote reactions
  if (showDiscussionVotes) {
    return (
      <div className="flex max-w-full items-center gap-0.5 sm:gap-1">
        {DISCUSSION_VOTE_EMOJIS.map((emoji, index) => {
          const isSelected =
            index === 0 ? isDiscussionUpvoteEmoji(myLastEmoji) : isDiscussionDownvoteEmoji(myLastEmoji)
          const count = index === 0 ? upVoteCount : downVoteCount
          const arrow = index === 0 ? DISCUSSION_UPVOTE_DISPLAY : DISCUSSION_DOWNVOTE_DISPLAY
          return (
            <div
              key={emoji}
              className={cn(
                'flex h-full shrink-0 items-center rounded',
                isSelected ? 'bg-muted text-primary' : 'text-muted-foreground'
              )}
            >
              <button
                type="button"
                className="flex h-full shrink-0 items-center px-2 sm:px-2.5 enabled:hover:text-primary touch-manipulation"
                {...signControlProps({
                  title: emoji === '+' ? t('Upvote') : t('Downvote'),
                  disabled: liking
                })}
                onClick={() => {
                  like(emoji)
                }}
              >
                {liking ? (
                  <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden />
                ) : (
                  <span className="text-base leading-none" aria-hidden>
                    {arrow}
                  </span>
                )}
              </button>
              {!hideCount && (noteStats?.updatedAt != null || count > 0) ? (
                <DiscussionVoteCountHover noteStats={noteStats} vote={index === 0 ? 'up' : 'down'}>
                  <div className="pr-1 text-sm tabular-nums sm:pr-2">
                    {count >= 100 ? '99+' : count}
                  </div>
                </DiscussionVoteCountHover>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  const likeEmojiPicker = (
    <EmojiPicker
      reactionsDefaultOpen
      reactions={[...EMOJI_PICKER_REACTIONS]}
      onEmojiClick={(emoji, e) => {
        e.stopPropagation()
        setIsEmojiReactionsOpen(false)
        if (!emoji) return
        like(emoji)
      }}
    />
  )

  if (isSmallScreen) {
    return (
      <>
        <div className="flex h-full min-w-0 items-center">
          {likeIconButton}
          {likeCountLabel}
        </div>
        <Drawer handleOnly open={isEmojiReactionsOpen} onOpenChange={setIsEmojiReactionsOpen}>
          <DrawerContent
            dragHandle="vaul"
            className="max-h-[min(88dvh,calc(100dvh-5rem))]"
            onPointerDownOutside={(e) => {
              const t = e.target as HTMLElement | null
              if (t?.closest?.('[data-vaul-overlay]')) return
              e.preventDefault()
            }}
          >
            <DrawerHeader className="sr-only">
              <DrawerTitle>React</DrawerTitle>
            </DrawerHeader>
            <div className="flex min-h-0 w-full max-h-[min(72dvh,calc(100dvh-6rem))] flex-col overflow-hidden px-1 pb-1">
              {isEmojiReactionsOpen ? likeEmojiPicker : null}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <div className="flex h-full min-w-0 items-center">
      <DropdownMenu open={isEmojiReactionsOpen} onOpenChange={setIsEmojiReactionsOpen}>
        <DropdownMenuTrigger asChild>{likeIconButton}</DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="p-0 w-fit">
          {likeEmojiPicker}
        </DropdownMenuContent>
      </DropdownMenu>
      {likeCountLabel}
    </div>
  )
}

export default function LikeButton({ event, hideCount = false }: LikeButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  const isReplyToDiscussion = useReplyUnderDiscussionRoot(event)
  return (
    <LikeButtonWithStats
      event={event}
      hideCount={hideCount}
      noteStats={noteStats}
      isReplyToDiscussion={isReplyToDiscussion}
    />
  )
}
