import { ExtendedKind } from '@/constants'
import {
  isDiscussionDownvoteEmoji,
  isDiscussionUpvoteEmoji
} from '@/lib/discussion-votes'
import { getRootEventHexId } from '@/lib/event'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getFirstHexEventIdFromETags } from '@/lib/tag'
import { eventService } from '@/services/client.service'
import type { NEvent } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'

export type NotificationReactionDisplay =
  | { status: 'vote_up' }
  | { status: 'vote_down' }
  | { status: 'discussion_custom' }
  | { status: 'default' }

function classifyDiscussionReactionFromTargets(
  reaction: Event,
  target: NEvent,
  root: NEvent | undefined
): NotificationReactionDisplay {
  let inDiscussion = target.kind === ExtendedKind.DISCUSSION
  if (!inDiscussion && target.kind === ExtendedKind.COMMENT) {
    inDiscussion = root?.kind === ExtendedKind.DISCUSSION
  }
  if (!inDiscussion) return { status: 'default' }
  const raw = reaction.content?.trim() ?? ''
  if (isDiscussionUpvoteEmoji(raw)) return { status: 'vote_up' }
  if (isDiscussionDownvoteEmoji(raw)) return { status: 'vote_down' }
  return { status: 'discussion_custom' }
}

function peekReactionDisplayFromSessionCaches(event: Event): NotificationReactionDisplay {
  if (event.kind !== kinds.Reaction) return { status: 'default' }
  const targetId = getFirstHexEventIdFromETags(event.tags)
  if (!targetId) return { status: 'default' }
  const target = eventService.peekHexIdNoteFromSessionCache(targetId)
  if (!target) return { status: 'default' }
  let root: NEvent | undefined
  if (target.kind === ExtendedKind.COMMENT) {
    const rootId = getRootEventHexId(target)
    if (rootId) root = eventService.peekHexIdNoteFromSessionCache(rootId)
  }
  return classifyDiscussionReactionFromTargets(event, target, root)
}

/**
 * For kind 7: resolves whether the reacted-to note is a discussion (kind 11 or 1111 under 11)
 * and classifies +/- / ⬆️⬇️ as vote display vs other reactions.
 *
 * Always starts from session cache (sync) so the glyph is never a blank skeleton; async fetch refines
 * when the target was not yet in memory.
 */
export function useNotificationReactionDisplay(event: Event): NotificationReactionDisplay {
  const targetId = useMemo(() => {
    if (event.kind !== kinds.Reaction) return undefined
    return getFirstHexEventIdFromETags(event.tags)
  }, [event.kind, event.tags])

  const reactionRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])

  const [state, setState] = useState<NotificationReactionDisplay>({ status: 'default' })

  useLayoutEffect(() => {
    setState(peekReactionDisplayFromSessionCaches(event))
  }, [event.id, event.kind, event.content, event.tags])

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
    const fetchOpts = reactionRelayHints.length ? { relayHints: reactionRelayHints } : undefined

    ;(async () => {
      const target = await eventService.fetchEvent(targetId, fetchOpts)
      if (cancelled) return
      if (!target) {
        setState({ status: 'default' })
        return
      }

      let root: NEvent | undefined
      let inDiscussion = target.kind === ExtendedKind.DISCUSSION
      if (!inDiscussion && target.kind === ExtendedKind.COMMENT) {
        const rootId = getRootEventHexId(target)
        if (rootId) {
          const rootHints = relayHintsFromEventTags(target)
          const rootOpts = rootHints.length ? { relayHints: rootHints } : fetchOpts
          root = await eventService.fetchEvent(rootId, rootOpts)
          if (cancelled) return
          inDiscussion = root?.kind === ExtendedKind.DISCUSSION
        }
      }

      if (!inDiscussion) {
        setState({ status: 'default' })
        return
      }

      setState(classifyDiscussionReactionFromTargets(event, target, root))
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
