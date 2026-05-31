import { ExtendedKind } from '@/constants'
import {
  eventHasExactNotificationThreadWatchRef,
  parseThreadWatchListRefs
} from '@/lib/notification-thread-watch'
import { useNotificationThreadWatchOptional } from '@/providers/NotificationThreadWatchProvider'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'

/** Local kind 19130 / 19132 lists — thread follow/mute menu state (not the open note’s kind). */
export function useThreadNotificationMenuState(event: Event) {
  const { pubkey } = useNostr()
  const threadWatch = useNotificationThreadWatchOptional()
  const [idbFollowed, setIdbFollowed] = useState(false)
  const [idbMuted, setIdbMuted] = useState(false)

  const refreshFromIdb = useCallback(async () => {
    if (!pubkey) {
      setIdbFollowed(false)
      setIdbMuted(false)
      return
    }
    const pk = pubkey.trim().toLowerCase()
    try {
      const [followEv, muteEv] = await Promise.all([
        indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST),
        indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST)
      ])
      const followRefs = parseThreadWatchListRefs(followEv ?? undefined)
      const muteRefs = parseThreadWatchListRefs(muteEv ?? undefined)
      setIdbFollowed(eventHasExactNotificationThreadWatchRef(event, followRefs))
      setIdbMuted(eventHasExactNotificationThreadWatchRef(event, muteRefs))
    } catch {
      setIdbFollowed(false)
      setIdbMuted(false)
    }
  }, [pubkey, event.id, event.kind, event.created_at])

  useEffect(() => {
    void refreshFromIdb()
  }, [
    refreshFromIdb,
    threadWatch?.eventsIFollowListEvent?.id,
    threadWatch?.eventsIMutedListEvent?.id
  ])

  const threadFollowed = threadWatch
    ? threadWatch.isFollowedForNotifications(event)
    : idbFollowed
  const threadMuted = threadWatch
    ? threadWatch.isMutedForNotifications(event)
    : idbMuted

  return { threadFollowed, threadMuted, threadWatch }
}
