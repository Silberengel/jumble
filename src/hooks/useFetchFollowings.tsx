import { getPubkeysFromPTags } from '@/lib/tag'
import { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

export function useFetchFollowings(pubkey?: string | null, refreshNonce = 0) {
  const [followListEvent, setFollowListEvent] = useState<Event | null>(null)
  const [followings, setFollowings] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setIsFetching(true)
      setFollowListEvent(null)
      setFollowings([])
      try {
        if (!pubkey?.trim()) {
          return
        }

        const event = (await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Contacts)) ?? null
        if (cancelled) return
        if (!event) {
          setFollowListEvent(null)
          setFollowings([])
          return
        }

        setFollowListEvent(event)
        setFollowings(getPubkeysFromPTags(event.tags))
      } finally {
        if (!cancelled) {
          setIsFetching(false)
        }
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [pubkey, refreshNonce])

  return { followings, followListEvent, isFetching }
}
