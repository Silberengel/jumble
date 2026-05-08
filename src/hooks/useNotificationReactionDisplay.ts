import { ExtendedKind } from '@/constants'
import {
  isDiscussionDownvoteEmoji,
  isDiscussionUpvoteEmoji
} from '@/lib/discussion-votes'
import { getRootEventHexId } from '@/lib/event'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getFirstHexEventIdFromETags } from '@/lib/tag'
import { eventService } from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

export type NotificationReactionDisplay =
  | { status: 'pending' }
  | { status: 'vote_up' }
  | { status: 'vote_down' }
  | { status: 'discussion_custom' }
  | { status: 'default' }

/**
 * For kind 7: resolves whether the reacted-to note is a discussion (kind 11 or 1111 under 11)
 * and classifies +/- / ⬆️⬇️ as vote display vs other reactions.
 */
export function useNotificationReactionDisplay(event: Event): NotificationReactionDisplay {
  const targetId = useMemo(() => {
    if (event.kind !== kinds.Reaction) return undefined
    return getFirstHexEventIdFromETags(event.tags)
  }, [event.kind, event.tags])

  const reactionRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])

  const [state, setState] = useState<NotificationReactionDisplay>(() =>
    event.kind === kinds.Reaction ? { status: 'pending' } : { status: 'default' }
  )

  useEffect(() => {
    if (event.kind === ExtendedKind.EXTERNAL_REACTION) {
      setState({ status: 'default' })
      return
    }
    if (event.kind !== kinds.Reaction) {
      setState({ status: 'default' })
      return
    }
    if (!targetId) {
      setState({ status: 'default' })
      return
    }

    let cancelled = false
    setState({ status: 'pending' })

    const fetchOpts = reactionRelayHints.length ? { relayHints: reactionRelayHints } : undefined

    ;(async () => {
      const target = await eventService.fetchEvent(targetId, fetchOpts)
      if (cancelled) return
      if (!target) {
        setState({ status: 'default' })
        return
      }

      let inDiscussion = target.kind === ExtendedKind.DISCUSSION
      if (!inDiscussion && target.kind === ExtendedKind.COMMENT) {
        const rootId = getRootEventHexId(target)
        if (rootId) {
          const rootHints = relayHintsFromEventTags(target)
          const rootOpts = rootHints.length ? { relayHints: rootHints } : fetchOpts
          const root = await eventService.fetchEvent(rootId, rootOpts)
          if (cancelled) return
          inDiscussion = root?.kind === ExtendedKind.DISCUSSION
        }
      }

      if (!inDiscussion) {
        setState({ status: 'default' })
        return
      }

      const raw = event.content?.trim() ?? ''
      if (isDiscussionUpvoteEmoji(raw)) {
        setState({ status: 'vote_up' })
      } else if (isDiscussionDownvoteEmoji(raw)) {
        setState({ status: 'vote_down' })
      } else {
        setState({ status: 'discussion_custom' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [event.id, event.kind, event.content, targetId, reactionRelayHints])

  return state
}

export function notificationReactionSummaryKey(
  display: NotificationReactionDisplay
):
  | 'Notification discussion upvote summary'
  | 'Notification discussion downvote summary'
  | 'Notification reaction summary' {
  if (display.status === 'vote_up') return 'Notification discussion upvote summary'
  if (display.status === 'vote_down') return 'Notification discussion downvote summary'
  return 'Notification reaction summary'
}
