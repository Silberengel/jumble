import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useRssUrlThreadQueryRelays } from '@/hooks/useRssUrlThreadQueryRelays'
import noteStatsService from '@/services/note-stats.service'
import { ExtendedKind } from '@/constants'
import { useReplyUnderDiscussionRoot } from '@/hooks/useReplyUnderDiscussionRoot'
import { shouldHideInteractions } from '@/lib/event-filtering'
import logger from '@/lib/logger'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'
import BookmarkButton from '../BookmarkButton'
import LikeButton from './LikeButton'
import Likes from './Likes'
import ReplyButton from './ReplyButton'
import RepostButton from './RepostButton'
import SeenOnButton from './SeenOnButton'
import ZapButton from './ZapButton'

export default function NoteStats({
  event,
  className,
  classNames,
  fetchIfNotExisting = false,
  displayTopZapsAndLikes = false
}: {
  event: Event
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
  displayTopZapsAndLikes?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const { relays: hintRelays, key: hintRelaysKey } = useNoteStatsRelayHints()
  const { relayUrls: rssUrlThreadRelays, key: rssUrlThreadRelaysKey } = useRssUrlThreadQueryRelays()
  const [loading, setLoading] = useState(false)
  
  // Hide boost button for discussion events and replies to discussions
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const isReplyToDiscussion = useReplyUnderDiscussionRoot(event)
  
  // Hide interaction counts if event is in quiet mode
  const hideInteractions = shouldHideInteractions(event)

  /** Synthetic RSS article root: no boost/quote/zap; still show reaction breakdown (NIP-25 + kind-17 web). */
  const isRssArticleRoot = event.kind === ExtendedKind.RSS_THREAD_ROOT
  /** Match {@link RssUrlThreadStatsBar}: inbox/favorites/fast-read merge — plain hints miss many #i indexers. */
  const statsRelays = isRssArticleRoot ? rssUrlThreadRelays : hintRelays
  const statsRelaysKey = isRssArticleRoot ? rssUrlThreadRelaysKey : hintRelaysKey
  const isZapPoll = event.kind === ExtendedKind.ZAP_POLL

  /** Emoji reaction pills (aggregated likes). Shown for RSS/Web URL threads so the side panel matches feed rows. */
  const showLikesPills = !isDiscussion && !isReplyToDiscussion

  useEffect(() => {
    if (!fetchIfNotExisting) return
    logger.debug('[NoteStats] UI: scheduling fetchNoteStats', {
      eventId: `${event.id.slice(0, 12)}…`,
      kind: event.kind,
      hintRelayCount: statsRelays.length
    })
    setLoading(true)
    noteStatsService.fetchNoteStats(event, pubkey, statsRelays).finally(() => setLoading(false))
    // Intentionally omit `event` object: parent feeds often pass new references each render;
    // id/sig/kind/created_at identify the note for refetch boundaries.
  }, [event.id, event.kind, event.created_at, event.sig, fetchIfNotExisting, pubkey, statsRelaysKey])

  if (isSmallScreen) {
    return (
      <div className={cn('select-none', className)} data-note-stats onClick={(e) => e.stopPropagation()}>
        {displayTopZapsAndLikes && (
          <>
            {showLikesPills && <Likes event={event} />}
          </>
        )}
        <div
          className={cn(
            'flex justify-between items-center h-5 [&_svg]:size-5',
            loading ? 'animate-pulse' : '',
            classNames?.buttonBar
          )}
        >
          <ReplyButton event={event} hideCount={hideInteractions} />
          {!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot && (
            <RepostButton event={event} hideCount={hideInteractions} />
          )}
          <LikeButton event={event} hideCount={hideInteractions} />
          {!isRssArticleRoot && !isZapPoll && (
            <ZapButton event={event} hideCount={hideInteractions} />
          )}
          {!isRssArticleRoot && <BookmarkButton event={event} />}
          <SeenOnButton event={event} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)} data-note-stats onClick={(e) => e.stopPropagation()}>
      {displayTopZapsAndLikes && (
        <>
          {showLikesPills && <Likes event={event} />}
        </>
      )}
      <div className="flex justify-between h-5 [&_svg]:size-4">
        <div
          className={cn('flex items-center', loading ? 'animate-pulse' : '')}
        >
          <ReplyButton event={event} hideCount={hideInteractions} />
          {!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot && (
            <RepostButton event={event} hideCount={hideInteractions} />
          )}
          <LikeButton event={event} hideCount={hideInteractions} />
          {!isRssArticleRoot && !isZapPoll && (
            <ZapButton event={event} hideCount={hideInteractions} />
          )}
        </div>
        <div className="flex items-center">
          {!isRssArticleRoot && <BookmarkButton event={event} />}
          <SeenOnButton event={event} />
        </div>
      </div>
    </div>
  )
}
