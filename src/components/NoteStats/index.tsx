import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import noteStatsService from '@/services/note-stats.service'
import { ExtendedKind } from '@/constants'
import { useReplyUnderDiscussionRoot } from '@/hooks/useReplyUnderDiscussionRoot'
import { Event } from 'nostr-tools'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LikeButtonWithStats } from './LikeButton'
import { ReplyButtonWithStats } from './ReplyButton'
import { RepostButtonWithStats } from './RepostButton'
import { ZapButtonWithStats } from './ZapButton'

/** One slot in the note action bar; left-aligned with gap spacing (not equal-width columns). */
function NoteStatsBarItem({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden [&>*]:min-w-0 [&>*]:max-w-full',
        className
      )}
    >
      {children}
    </div>
  )
}

export default function NoteStats({
  event,
  className,
  classNames,
  fetchIfNotExisting = false,
  foregroundStats = false,
  useIconOnlyLikeTrigger = false
}: {
  event: Event
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
  /** Relay-backed stats only on the open note / article panel (`foregroundStats`). */
  foregroundStats?: boolean
  /**
   * Thread rows for kind-7 reactions: like control shows icon + total only (body already shows the reaction glyph).
   */
  useIconOnlyLikeTrigger?: boolean
}) {
  const { pubkey } = useNostr()
  const noteStats = useNoteStatsById(event.id)
  const { relays: hintRelays, currentRelaysKey } = useNoteStatsRelayHints()
  const [loading, setLoading] = useState(false)

  // Hide boost button for discussion events and replies to discussions
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const isReplyToDiscussion = useReplyUnderDiscussionRoot(event)

  /** Synthetic RSS article root: no boost/quote/zap bar entries that normal notes have. */
  const isRssArticleRoot = event.kind === ExtendedKind.RSS_THREAD_ROOT
  const statsFetchRelayScopeKey = currentRelaysKey
  const statsRelaysRef = useRef(hintRelays)
  statsRelaysRef.current = hintRelays

  useEffect(() => {
    if (!fetchIfNotExisting || !foregroundStats) return
    setLoading(true)
    noteStatsService
      .fetchNoteStats(event, pubkey, statsRelaysRef.current, { foreground: true })
      .finally(() => setLoading(false))
  }, [
    event.id,
    event.kind,
    event.created_at,
    event.sig,
    fetchIfNotExisting,
    foregroundStats,
    pubkey,
    statsFetchRelayScopeKey
  ])

  /** Kind 11 / 1111 under a discussion: up+down votes need more width than a single like button. */
  const isDiscussionBar = isDiscussion || isReplyToDiscussion
  const voteBarItem = isDiscussionBar ? 'min-w-[6.75rem] sm:min-w-[7.25rem]' : undefined

  const barItems: ReactNode[] = [
    <NoteStatsBarItem key="reply">
      <ReplyButtonWithStats event={event} noteStats={noteStats} />
    </NoteStatsBarItem>
  ]

  if (!isDiscussion && !isReplyToDiscussion && !isRssArticleRoot) {
    barItems.push(
      <NoteStatsBarItem key="repost">
        <RepostButtonWithStats event={event} noteStats={noteStats} />
      </NoteStatsBarItem>
    )
  }

  barItems.push(
    <NoteStatsBarItem key="like" className={voteBarItem}>
      <LikeButtonWithStats
        event={event}
        noteStats={noteStats}
        isReplyToDiscussion={isReplyToDiscussion}
        useIconOnlyLikeTrigger={useIconOnlyLikeTrigger}
      />
    </NoteStatsBarItem>
  )

  if (!isRssArticleRoot) {
    barItems.push(
      <NoteStatsBarItem key="tip">
        <ZapButtonWithStats event={event} noteStats={noteStats} />
      </NoteStatsBarItem>
    )
  }

  return (
    <div
      className={cn('select-none min-w-0', className)}
      data-note-stats
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'flex w-full min-w-0 flex-wrap items-center justify-start gap-x-6 gap-y-2 sm:gap-x-5',
          '[&_svg]:size-5 [&_button]:min-h-11 [&_button]:max-w-full [&_button]:px-3 [&_button]:touch-manipulation sm:[&_button]:min-h-10 sm:[&_button]:px-2',
          loading ? 'animate-pulse' : '',
          classNames?.buttonBar
        )}
      >
        {barItems}
      </div>
    </div>
  )
}
