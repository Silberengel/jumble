import NoteList, { type TNoteListRef } from '@/components/NoteList'
import NoteCard from '@/components/NoteCard'
import FeedFilterToolbarRow, { feedFilterRowChromeClass } from '@/components/FeedFilterToolbarRow'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind, PROFILE_FEED_KINDS, PROFILE_TIMELINE_REQ_LIMIT } from '@/constants'
import { useProfileAuthorFeedSubRequests } from '@/hooks/useProfileAuthorFeedSubRequests'
import { useProfilePins } from '@/hooks/useProfilePins'
import { feedSeenOnAllowlistFromSubRequests } from '@/lib/feed-seen-on-allowlist'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useDeletedEventSafe } from '@/providers/DeletedEventProvider'
import client from '@/services/client.service'
import { nip19, kinds } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const profileFeedKinds = [...PROFILE_FEED_KINDS]

const ProfileFeed = forwardRef<
  { refresh: () => void },
  { pubkey: string; /** Payment methods, badges, and other author replaceables. */ onRefreshExtras?: () => void }
>(({ pubkey, onRefreshExtras }, ref) => {
  const { t } = useTranslation()
  const { isEventDeleted } = useDeletedEventSafe()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111, feedKindFilterBypass } =
    useKindFilterOrDefaults()
  const profileTimelineShowKinds = useMemo(() => {
    if (showKinds.includes(kinds.Repost) && showKinds.includes(ExtendedKind.GENERIC_REPOST)) {
      return showKinds
    }
    const next = [...showKinds]
    if (!next.includes(kinds.Repost)) next.push(kinds.Repost)
    if (!next.includes(ExtendedKind.GENERIC_REPOST)) next.push(ExtendedKind.GENERIC_REPOST)
    return next.sort((a, b) => a - b)
  }, [showKinds])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const noteListRef = useRef<TNoteListRef>(null)
  const [feedFilterTabRowHost, setFeedFilterTabRowHost] = useState<HTMLDivElement | null>(null)
  const [feedFilterPanelHost, setFeedFilterPanelHost] = useState<HTMLDivElement | null>(null)
  const onFeedFilterTabRowSlotRef = useCallback((node: HTMLDivElement | null) => {
    setFeedFilterTabRowHost((prev) => (Object.is(prev, node) ? prev : node))
  }, [])
  const onFeedFilterPanelHostRef = useCallback((node: HTMLDivElement | null) => {
    setFeedFilterPanelHost((prev) => (Object.is(prev, node) ? prev : node))
  }, [])

  const { pinEvents, loadingPins, refreshPins } = useProfilePins(pubkey)

  const { subRequests, followingFeedDeltaSubRequests, feedSubscriptionKey, refresh: refreshAuthorRelayLayers } =
    useProfileAuthorFeedSubRequests({
      pubkey,
      kinds: profileFeedKinds,
      limit: PROFILE_TIMELINE_REQ_LIMIT
    })

  const seenOnAllowlist = useMemo(
    () => feedSeenOnAllowlistFromSubRequests(subRequests, followingFeedDeltaSubRequests),
    [subRequests, followingFeedDeltaSubRequests]
  )

  const pinnedEventIds = useMemo(
    () =>
      pinEvents.map((e) =>
        nip19.neventEncode({ id: e.id, author: e.pubkey, kind: e.kind })
      ),
    [pinEvents]
  )

  const refreshAll = useCallback(() => {
    setIsRefreshing(true)
    refreshPins()
    refreshAuthorRelayLayers()
    noteListRef.current?.refresh()
    void client.fetchDeletionEventsForPubkey(pubkey)
    onRefreshExtras?.()
  }, [refreshPins, refreshAuthorRelayLayers, pubkey, onRefreshExtras])

  useImperativeHandle(ref, () => ({ refresh: refreshAll }), [refreshAll])

  useEffect(() => {
    if (!isRefreshing) return
    const id = window.setTimeout(() => setIsRefreshing(false), 600)
    return () => clearTimeout(id)
  }, [isRefreshing])

  const handleShowKindsChange = useCallback(() => {
    noteListRef.current?.scrollToTop()
  }, [])

  const showPinsOnlySkeleton = pinEvents.length === 0 && loadingPins && subRequests.length === 0

  if (showPinsOnlySkeleton) {
    return (
      <div className="mt-4 space-y-2 px-1">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (!subRequests.length) {
    return (
      <div className="mt-4 px-2">
        <p className="py-8 text-center text-sm text-muted-foreground">{t('Nothing to load for this feed.')}</p>
      </div>
    )
  }

  return (
    <div className="mt-4 min-w-0">
      {isRefreshing && (
        <div
          className="mb-2 flex items-center justify-center gap-2 px-4 py-2 text-center text-sm text-green-500"
          role="status"
          aria-live="polite"
        >
          {t('Refreshing posts...')}
        </div>
      )}
      <div className={cn('mb-2 px-1', feedFilterRowChromeClass)}>
        <FeedFilterToolbarRow
          showKinds={showKinds}
          onShowKindsChange={handleShowKindsChange}
          onRefresh={refreshAll}
          feedFilterTabRowSlotRef={onFeedFilterTabRowSlotRef}
          includeFeedSearchSlot
        />
      </div>
      <div ref={onFeedFilterPanelHostRef} className="min-w-0 px-1" />
      {pinEvents.filter((e) => !isEventDeleted(e)).length > 0 && (
        <div className="mb-3 space-y-2 px-1" aria-label={t('Pinned posts')}>
          {pinEvents
            .filter((e) => !isEventDeleted(e))
            .map((event) => (
              <NoteCard
                key={event.id}
                className="w-full"
                event={event}
                filterMutedNotes={false}
                pinned
                seenOnAllowlist={seenOnAllowlist.length > 0 ? seenOnAllowlist : undefined}
              />
            ))}
          <div className="border-t border-border/60 px-2 py-1 text-xs text-muted-foreground">{t('Feed')}</div>
        </div>
      )}
      <div className="min-h-[min(40vh,320px)] min-w-0">
        <NoteList
          ref={noteListRef}
          subRequests={subRequests}
          followingFeedDeltaSubRequests={followingFeedDeltaSubRequests}
          feedSubscriptionKey={feedSubscriptionKey}
          hostPrimaryPageName="profile"
          showKinds={profileTimelineShowKinds}
          seeAllFeedEvents={feedKindFilterBypass}
          showAllKinds={feedKindFilterBypass}
          withKindFilter
          useFilterAsIs
          clientSideKindFilter
          preserveTimelineOnSubRequestsChange
          mergeTimelineWhenSubRequestFiltersMatch
          pinnedEventIds={pinnedEventIds}
          hideReplies={false}
          filterMutedNotes={false}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          showFeedClientFilter
          feedClientFilterTabRowHost={feedFilterTabRowHost}
          feedClientFilterPanelHost={feedFilterPanelHost}
          timelinePublicReadFallback
          revealBatchSize={48}
          seenOnAllowlist={seenOnAllowlist.length > 0 ? seenOnAllowlist : undefined}
        />
      </div>
    </div>
  )
})

ProfileFeed.displayName = 'ProfileFeed'

export default ProfileFeed
