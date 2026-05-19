import { useNostrOptional } from '@/providers/nostr-context'
import { getCacheRelayUrls } from '@/lib/private-relays'
import { buildProfileReportsRelayUrls } from '@/lib/profile-reports-relays'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProfileTimelineRelayUrlsBuilder } from '@/hooks/useProfileTimeline'

/** Relay list builder for the profile Reports tab (inbox + HTTP index + cache when viewing own profile). */
export function useProfileReportsRelayBuilder(pubkey: string): ProfileTimelineRelayUrlsBuilder {
  const nostr = useNostrOptional()
  const [cacheRelayUrls, setCacheRelayUrls] = useState<string[]>([])

  const isSelf = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    if (!me) return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(me), normalizeHexPubkey(pubkey))
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])

  useEffect(() => {
    if (!isSelf || !nostr?.pubkey?.trim()) {
      setCacheRelayUrls([])
      return
    }
    let cancelled = false
    void getCacheRelayUrls(nostr.pubkey).then((urls) => {
      if (!cancelled) setCacheRelayUrls(urls)
    })
    return () => {
      cancelled = true
    }
  }, [isSelf, nostr?.pubkey])

  return useCallback<ProfileTimelineRelayUrlsBuilder>(
    (_favoriteRelays, blocked, authorRelayList, includeAuthorLocalRelays) =>
      buildProfileReportsRelayUrls(authorRelayList, blocked, {
        includeAuthorLocalRelays,
        cacheRelayUrls: isSelf ? cacheRelayUrls : []
      }),
    [cacheRelayUrls, isSelf]
  )
}
