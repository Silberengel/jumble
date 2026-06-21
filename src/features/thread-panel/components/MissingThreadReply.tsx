import UserAvatar from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  fetchMissingStatsReplyEvent,
  missingStatsReplyLookupPointers,
  normalizeHexEventId
} from '@/features/thread-panel/thread-panel-utils'
import { buildNoteLookupSearchFallbackRelayUrls, buildViewerNostrLandAggrEligibilityUrls } from '@/lib/feed-full-search-relays'
import { getCacheRelayUrlsFromEvent } from '@/lib/private-relays'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import client from '@/services/client.service'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import { Search } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function MissingThreadReply({
  id,
  pubkey,
  createdAt,
  onFound
}: {
  id: string
  pubkey: string
  createdAt: number
  /** Called when the note is found on search relays — thread list should ingest the event. */
  onFound?: (event: Event) => void
}) {
  const { t } = useTranslation()
  const nostr = useNostrOptional()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const nostrLandAggrEligibilityUrls = useMemo(
    () =>
      buildViewerNostrLandAggrEligibilityUrls({
        favoriteRelayUrls: favoriteRelays,
        relayList: nostr?.relayList,
        cacheRelayUrls: getCacheRelayUrlsFromEvent(nostr?.cacheRelayListEvent)
      }),
    [favoriteRelays, nostr?.relayList, nostr?.cacheRelayListEvent]
  )
  const [copied, setCopied] = useState(false)
  const [searching, setSearching] = useState(false)
  const [triedSearch, setTriedSearch] = useState(false)

  const lookupLabel = useMemo(() => {
    const pointers = missingStatsReplyLookupPointers({ id, pubkey })
    return pointers.find((p) => p.startsWith('nevent1')) ?? pointers[0] ?? id
  }, [id, pubkey])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(lookupLabel)
      setCopied(true)
      toast.success(t('Copied!'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('Copy failed', { defaultValue: 'Copy failed' }))
    }
  }

  const onSearch = async () => {
    if (searching) return
    if (!normalizeHexEventId(id)) {
      toast.error(
        t('Invalid event id for search', { defaultValue: 'Invalid event id for search' })
      )
      return
    }
    setSearching(true)
    setTriedSearch(false)
    try {
      const relayUrls = sanitizeRelayUrlsForFetch(
        await buildNoteLookupSearchFallbackRelayUrls({
          viewerPubkey: nostr?.pubkey,
          favoriteRelays,
          blockedRelays,
          nostrLandAggrEligibilityUrls
        })
      )
      const found = await fetchMissingStatsReplyEvent({ id, pubkey }, relayUrls)
      if (found) {
        const hex = normalizeHexEventId(found.id) ?? normalizeHexEventId(id)!
        client.addEventToCache(found, { explicitNoteLookupHexId: hex })
        onFound?.(found)
        toast.success(t('Note found', { defaultValue: 'Note found' }))
        return
      }
      setTriedSearch(true)
      toast.error(
        t('Note not found on search relays', {
          defaultValue: 'Note not found on search relays'
        })
      )
    } catch {
      setTriedSearch(true)
      toast.error(
        t('Search relay query failed', {
          defaultValue: 'Search relay query failed'
        })
      )
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="border-b border-dashed border-border/70 pb-3">
      <div className="flex gap-2 sm:gap-3 px-2 sm:px-4 md:px-6 pt-2">
        <UserAvatar userId={pubkey} size="small" className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            {t('Thread reply not loaded locally', {
              defaultValue: 'This reply is counted in stats but could not be loaded from cache or relays.'
            })}
          </p>
          <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <code className="block break-all text-xs text-foreground/90">{lookupLabel}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCopy} disabled={searching}>
              {copied ? t('Copied!') : t('Copy nevent', { defaultValue: 'Copy nevent' })}
            </Button>
            <Button type="button" variant="default" size="sm" onClick={() => void onSearch()} disabled={searching}>
              {searching ? (
                <>
                  <Skeleton className="mr-1.5 size-3.5 shrink-0 rounded-sm" aria-hidden />
                  {t('Searching search relays…', { defaultValue: 'Searching search relays…' })}
                </>
              ) : (
                <>
                  <Search className="mr-1.5 size-3.5" aria-hidden />
                  {t('Search for this note', { defaultValue: 'Search for this note' })}
                </>
              )}
            </Button>
          </div>
          {triedSearch && !searching ? (
            <p className="text-xs text-muted-foreground">
              {t('Note not found on search relays', {
                defaultValue: 'Note not found on search relays'
              })}
            </p>
          ) : null}
          {createdAt > 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('Stats timestamp', { defaultValue: 'Counted at' })}{' '}
              {new Date(createdAt * 1000).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
