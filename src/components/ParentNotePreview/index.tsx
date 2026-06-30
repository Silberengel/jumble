import { Skeleton } from '@/components/ui/skeleton'
import { useFetchEvent } from '@/hooks'
import { useFetchThreadContextEvent } from '@/hooks/useFetchThreadContextEvent'
import { buildNoteLookupSearchFallbackRelayUrls, buildViewerNostrLandAggrEligibilityUrls } from '@/lib/feed-full-search-relays'
import { getCacheRelayUrlsFromEvent } from '@/lib/private-relays'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { useFavoriteRelaysOptional } from '@/providers/favorite-relays-context'
import { useNostrOptional } from '@/providers/nostr-context'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Event } from 'nostr-tools'
import ContentPreview from '../ContentPreview'
import UserAvatar from '../UserAvatar'
import logger from '@/lib/logger'

export default function ParentNotePreview({
  eventId,
  className,
  onClick,
  /** NIP-10 `e` relay hints from the child note — speeds up parent fetch in notifications and feeds. */
  relayHints,
  /** Child reply — pins kind-1 blurb to the revision cited in the reply, or original text if none. */
  replyContext,
  /** Inline hint without pill background (e.g. reply thread rows). */
  appearance = 'default'
}: {
  eventId: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement> | undefined
  relayHints?: string[]
  replyContext?: Event
  appearance?: 'default' | 'subtle'
}) {
  const { t } = useTranslation()
  const nostr = useNostrOptional()
  const favoriteRelaysCtx = useFavoriteRelaysOptional()
  const favoriteRelays = favoriteRelaysCtx?.favoriteRelays ?? []
  const blockedRelays = favoriteRelaysCtx?.blockedRelays ?? []
  const nostrLandAggrEligibilityUrls = useMemo(
    () =>
      buildViewerNostrLandAggrEligibilityUrls({
        favoriteRelayUrls: favoriteRelays,
        relayList: nostr?.relayList,
        cacheRelayUrls: getCacheRelayUrlsFromEvent(nostr?.cacheRelayListEvent)
      }),
    [favoriteRelays, nostr?.relayList, nostr?.cacheRelayListEvent]
  )
  const fetchOpts = useMemo(
    () => (relayHints?.length ? { relayHints } : undefined),
    [relayHints]
  )

  const threadFetch = useFetchThreadContextEvent(
    replyContext ? eventId : undefined,
    replyContext,
    'parent'
  )
  const plainFetch = useFetchEvent(replyContext ? undefined : eventId, undefined, fetchOpts)

  const event = replyContext ? threadFetch.event : plainFetch.event
  const isFetching = replyContext ? threadFetch.isFetching : plainFetch.isFetching

  const [fallbackEvent, setFallbackEvent] = useState<Event | undefined>(undefined)
  const [isFetchingFallback, setIsFetchingFallback] = useState(false)
  /** One automatic searchable-relay attempt per eventId; without this, the effect re-fires forever after each timeout. */
  const autoSearchableAttemptedRef = useRef(false)

  const fetchFromSearchableRelays = useCallback(async () => {
    if (!eventId?.trim()) return

    setIsFetchingFallback(true)
    try {
      const relayUrls = sanitizeRelayUrlsForFetch(
        await buildNoteLookupSearchFallbackRelayUrls({
          viewerPubkey: nostr?.pubkey,
          favoriteRelays,
          blockedRelays,
          relayHints,
          eventId,
          nostrLandAggrEligibilityUrls
        })
      )
      const foundEvent = await client.fetchEventWithExternalRelays(eventId, relayUrls)
      if (foundEvent) {
        client.addEventToCache(foundEvent)
        setFallbackEvent(foundEvent)
      }
    } catch (error) {
      logger.warn('Fallback fetch from searchable relays failed', error as Error)
    } finally {
      setIsFetchingFallback(false)
    }
  }, [
    eventId,
    nostr?.pubkey,
    favoriteRelays,
    blockedRelays,
    relayHints,
    nostrLandAggrEligibilityUrls
  ])

  useEffect(() => {
    autoSearchableAttemptedRef.current = false
    setFallbackEvent(undefined)
  }, [eventId])

  // Plain path only: thread path races search relays inside useFetchThreadContextEvent.
  useEffect(() => {
    if (replyContext) return
    if (
      !isFetching &&
      !event &&
      !fallbackEvent &&
      !isFetchingFallback &&
      eventId &&
      !autoSearchableAttemptedRef.current
    ) {
      autoSearchableAttemptedRef.current = true
      void fetchFromSearchableRelays()
    }
  }, [
    replyContext,
    isFetching,
    event,
    eventId,
    fallbackEvent,
    isFetchingFallback,
    fetchFromSearchableRelays
  ])

  const finalEvent = event || fallbackEvent
  const finalIsFetching = isFetching || isFetchingFallback

  const shellClass =
    appearance === 'subtle'
      ? 'flex gap-1.5 items-center text-xs w-full max-w-full text-muted-foreground'
      : 'flex gap-1 items-center text-sm rounded-full px-2 bg-muted w-fit max-w-full text-muted-foreground'

  if (finalIsFetching) {
    return (
      <div data-parent-note-preview className={cn(shellClass, appearance === 'subtle' && 'w-full', className)}>
        <div className="shrink-0">{t('reply to')}</div>
        <Skeleton className="w-4 h-4 rounded-full" />
        <div className={cn('flex-1 min-w-0', appearance === 'subtle' ? 'py-0' : 'py-1')}>
          <Skeleton className="h-3" />
        </div>
      </div>
    )
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (finalEvent) {
      onClick?.(e)
    } else if (!finalEvent && !finalIsFetching && eventId) {
      e.stopPropagation()
      if (replyContext) {
        threadFetch.refetch()
      } else {
        void fetchFromSearchableRelays()
      }
    }
  }

  return (
    <div
      data-parent-note-preview
      className={cn(
        shellClass,
        (finalEvent || (!finalEvent && !finalIsFetching)) && 'hover:text-foreground cursor-pointer',
        className
      )}
      onClick={handleClick}
    >
      <div className="shrink-0">{t('reply to')}</div>
      {finalEvent && <UserAvatar className="shrink-0" userId={finalEvent.pubkey} size="tiny" />}
      <div className="truncate flex-1 min-w-0">
        <ContentPreview
          className="pointer-events-none"
          event={finalEvent}
          previewDensity={appearance === 'subtle' ? 'compact' : 'default'}
          forParentReplyBlurb
          replyContext={replyContext}
        />
      </div>
    </div>
  )
}
