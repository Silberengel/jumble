import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { buildAuthorInboxOutboxRelayUrls } from '@/lib/favorites-feed-relays'
import { PROFILE_MEDIA_TAB_KINDS } from '@/constants'
import { buildProfileMediaSubRequests } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import { hexPubkeysEqual } from '@/lib/pubkey'
import client from '@/services/client.service'
import { forwardRef, useEffect, useMemo, useState } from 'react'

const ProfileMediaFeed = forwardRef<TNoteListRef, { pubkey: string }>(({ pubkey }, ref) => {
  const nostr = useNostrOptional()
  const { blockedRelays } = useFavoriteRelays()
  const includeAuthorLocalRelays = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    const pk = pubkey?.trim()
    if (!me || !pk) return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(me), normalizeHexPubkey(pk))
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])

  const [authorRelayUrls, setAuthorRelayUrls] = useState<string[] | null>(null)

  useEffect(() => {
    const pk = pubkey?.trim()
    if (!pk) {
      setAuthorRelayUrls([])
      return
    }
    let cancelled = false
    setAuthorRelayUrls(null)
    void client
      .fetchRelayList(pk)
      .catch(() => ({ read: [] as string[], write: [] as string[] }))
      .then((authorRl) => {
        if (cancelled) return
        setAuthorRelayUrls(buildAuthorInboxOutboxRelayUrls(authorRl, blockedRelays, includeAuthorLocalRelays))
      })
    return () => {
      cancelled = true
    }
  }, [pubkey, blockedRelays, includeAuthorLocalRelays])

  const subRequests = useMemo(() => {
    const pk = pubkey?.trim()
    if (!pk || !authorRelayUrls?.length) return []
    return buildProfileMediaSubRequests(authorRelayUrls, blockedRelays, pk)
  }, [pubkey, authorRelayUrls, blockedRelays])

  const feedSubscriptionKey = useMemo(() => {
    const pk = pubkey?.trim()
    if (!pk) return 'profile-media-empty'
    return `profile-media-${normalizeHexPubkey(pk)}`
  }, [pubkey])

  const showKinds = useMemo(() => [...PROFILE_MEDIA_TAB_KINDS], [])

  if (authorRelayUrls === null) {
    return (
      <div className="min-h-[min(40vh,320px)] min-w-0 px-2 py-8 text-center text-sm text-muted-foreground">
        {/* Skeleton while author NIP-65 resolves — avoids provisional→refined subRequest churn */}
      </div>
    )
  }

  if (!subRequests.length) {
    return (
      <div className="min-h-[min(40vh,320px)] min-w-0 px-2 py-8 text-center text-sm text-muted-foreground" />
    )
  }

  return (
    <div className="min-h-[min(40vh,320px)] min-w-0">
      <NoteList
        ref={ref}
        subRequests={subRequests}
        feedSubscriptionKey={feedSubscriptionKey}
        hostPrimaryPageName="profile"
        showKinds={showKinds}
        useFilterAsIs
        preserveTimelineOnSubRequestsChange
        mergeTimelineWhenSubRequestFiltersMatch
        revealBatchSize={48}
        filterMutedNotes={false}
        showKind1OPs
        showKind1Replies
        showKind1111
        hideReplies={false}
        timelinePublicReadFallback
      />
    </div>
  )
})

ProfileMediaFeed.displayName = 'ProfileMediaFeed'

export default ProfileMediaFeed
