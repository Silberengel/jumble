import { useNostrArchivesAvailable } from '@/hooks/useNostrArchivesAvailable'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import { useEffect, useState } from 'react'

export function useNostrArchivesSocial(pubkey?: string | null, refreshNonce = 0) {
  const archivesAvailable = useNostrArchivesAvailable()
  const [followersCount, setFollowersCount] = useState<number | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!pubkey?.trim() || !archivesAvailable) {
      setFollowersCount(null)
      setIsFetching(false)
      return
    }

    setIsFetching(true)
    void nostrArchivesApi
      .getSocialGraph(pubkey, { followsLimit: 0, followersLimit: 0 })
      .then((res) => {
        if (cancelled) return
        setFollowersCount(res.ok ? res.data.followers.count : null)
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [pubkey, refreshNonce, archivesAvailable])

  return {
    followersCount,
    isFetching,
    showFollowers: archivesAvailable && followersCount != null
  }
}
