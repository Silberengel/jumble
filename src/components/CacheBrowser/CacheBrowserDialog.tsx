import { Button } from '@/components/ui/button'
import logger from '@/lib/logger'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, RefreshCw, Database, WrapText, Search, X, TriangleAlert, Copy, Radio } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import indexedDb, { isLikelyCachedNostrEvent, StoreNames, type TCachedEventSearchHit } from '@/services/indexed-db.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { toast } from 'sonner'
import { Event } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { toastPublishPromise } from '@/lib/publishing-feedback'

const GLOBAL_CACHED_EVENTS_SEARCH_LIMIT = 400

export default function CacheBrowserDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey: accountPubkey } = useNostr()
  const [broadcastingKey, setBroadcastingKey] = useState<string | null>(null)
  const [cacheInfo, setCacheInfo] = useState<Record<string, number>>({})
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [storeItems, setStoreItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [cachedEventsSearch, setCachedEventsSearch] = useState('')
  const [globalSearchHits, setGlobalSearchHits] = useState<TCachedEventSearchHit[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchTruncated, setGlobalSearchTruncated] = useState(false)
  const [publicationListFull, setPublicationListFull] = useState(false)
  const [publicationStoreTotalRows, setPublicationStoreTotalRows] = useState<number | null>(null)
  const globalSearchRequestId = useRef(0)

  const loadCacheInfo = async () => {
    try {
      const info = await indexedDb.getStoreInfo()
      setCacheInfo(info)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to load cache info', { error: message })
    }
  }

  useEffect(() => {
    if (!open) return
    setSelectedStore(null)
    setStoreItems([])
    setSearchQuery('')
    setCachedEventsSearch('')
    setGlobalSearchHits([])
    setGlobalSearchTruncated(false)
    setPublicationListFull(false)
    setPublicationStoreTotalRows(null)
    void loadCacheInfo()
  }, [open])

  useEffect(() => {
    if (!open || selectedStore) return
    const q = cachedEventsSearch.trim()
    if (!q) {
      setGlobalSearchHits([])
      setGlobalSearchLoading(false)
      setGlobalSearchTruncated(false)
      return
    }
    const reqId = ++globalSearchRequestId.current
    setGlobalSearchLoading(true)
    const timer = window.setTimeout(() => {
      void indexedDb
        .searchAllCachedEventsFullText(q, { limit: GLOBAL_CACHED_EVENTS_SEARCH_LIMIT })
        .then((hits) => {
          if (globalSearchRequestId.current !== reqId) return
          setGlobalSearchHits(hits)
          setGlobalSearchTruncated(hits.length >= GLOBAL_CACHED_EVENTS_SEARCH_LIMIT)
          setGlobalSearchLoading(false)
        })
        .catch((e) => {
          logger.error('Cached events search failed', { e })
          if (globalSearchRequestId.current !== reqId) return
          setGlobalSearchHits([])
          setGlobalSearchTruncated(false)
          setGlobalSearchLoading(false)
        })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [cachedEventsSearch, open, selectedStore])

  const handleStoreClick = async (storeName: string) => {
    setSelectedStore(storeName)
    setSearchQuery('')
    setPublicationListFull(false)
    setPublicationStoreTotalRows(null)
    setLoadingItems(true)
    try {
      if (storeName === StoreNames.PUBLICATION_EVENTS) {
        const [items, allRows] = await Promise.all([
          indexedDb.getPublicationStoreItems(storeName),
          indexedDb.getStoreItems(storeName)
        ])
        setPublicationStoreTotalRows(allRows.length)
        setStoreItems(items)
      } else {
        const items = await indexedDb.getStoreItems(storeName)
        setStoreItems(items)
      }
    } catch (error) {
      logger.error('Failed to load store items', { error })
      toast.error(t('Failed to load store items'))
      setStoreItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const handleOpenSearchHit = async (hit: TCachedEventSearchHit) => {
    setSelectedStore(hit.storeName)
    setSearchQuery(hit.value.id)
    setPublicationListFull(hit.storeName === 'publicationEvents')
    setLoadingItems(true)
    try {
      const items = await indexedDb.getStoreItems(hit.storeName)
      setStoreItems(items)
    } catch (error) {
      logger.error('Failed to load store items', { error })
      toast.error(t('Failed to load store items'))
      setStoreItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const filteredStoreItems = useMemo(() => {
    if (!searchQuery.trim()) return storeItems
    const query = searchQuery.toLowerCase().trim()
    return storeItems.filter((item) => {
      if (item.key?.toLowerCase().includes(query)) return true
      try {
        if (JSON.stringify(item.value).toLowerCase().includes(query)) return true
      } catch {
        /* skip */
      }
      if (new Date(item.addedAt).toLocaleString().toLowerCase().includes(query)) return true
      return false
    })
  }, [storeItems, searchQuery])

  const handleDeleteItem = async (key: string) => {
    if (!selectedStore) return
    try {
      if (selectedStore === 'publicationEvents') {
        const parts = key.split(':')
        const pubkey = parts[0]
        const d = parts[1] || undefined
        const result = await indexedDb.deletePublicationAndNestedEvents(pubkey, d)
        toast.success(t('Deleted {{count}} event(s)', { count: result.deleted }))
      } else {
        await indexedDb.deleteStoreItem(selectedStore, key)
        toast.success(t('Item deleted successfully'))
      }
      const items =
        selectedStore === 'publicationEvents' && !publicationListFull
          ? await indexedDb.getPublicationStoreItems(selectedStore)
          : await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      void loadCacheInfo()
    } catch (error) {
      logger.error('Failed to delete item', { error })
      toast.error(t('Failed to delete item'))
    }
  }

  const handleDeleteAllItems = async () => {
    if (!selectedStore) return
    if (!confirm(t('Are you sure you want to delete all items from this store?'))) return
    try {
      await indexedDb.clearStore(selectedStore)
      setStoreItems([])
      void loadCacheInfo()
      toast.success(t('All items deleted successfully'))
    } catch (error) {
      logger.error('Failed to delete all items', { error })
      toast.error(t('Failed to delete all items'))
    }
  }

  const handleCleanupDuplicates = async () => {
    if (!selectedStore) return
    if (!confirm(t('Clean up duplicate replaceable events? This will keep only the newest version of each event.')))
      return
    setLoadingItems(true)
    try {
      const result = await indexedDb.cleanupDuplicateReplaceableEvents(selectedStore)
      setSearchQuery('')
      void loadCacheInfo()
      const items =
        selectedStore === StoreNames.PUBLICATION_EVENTS
          ? await indexedDb.getPublicationStoreItems(selectedStore)
          : await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      const actualCount = items.length
      if (actualCount !== result.kept) {
        toast.success(
          t('Cleaned up {{deleted}} duplicate entries, kept {{kept}} (total items after cleanup: {{total}})', {
            deleted: result.deleted,
            kept: result.kept,
            total: actualCount
          })
        )
      } else {
        toast.success(t('Cleaned up {{deleted}} duplicate entries, kept {{kept}}', { deleted: result.deleted, kept: result.kept }))
      }
    } catch (error) {
      logger.error('Failed to cleanup duplicates', { error })
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'Not a replaceable event store') {
        toast.error(t('This store does not contain replaceable events'))
      } else {
        toast.error(t('Failed to cleanup duplicates'))
      }
    } finally {
      setLoadingItems(false)
    }
  }

  const handleCopyItemJson = (item: { value: unknown }) => {
    try {
      const text = JSON.stringify(item.value, null, 2)
      void navigator.clipboard.writeText(text)
      toast.success(t('Copied to clipboard'))
    } catch {
      toast.error(t('Failed to copy'))
    }
  }

  const handleBroadcastToMailboxStack = useCallback(
    (event: Event, itemKey: string) => {
      if (!accountPubkey) {
        toast.error(t('Log in to broadcast'))
        return
      }
      if (event.pubkey?.toLowerCase() !== accountPubkey.toLowerCase()) {
        toast.error(t('Only the author can broadcast this event'))
        return
      }
      setBroadcastingKey(itemKey)
      const promise = (async () => {
        try {
          const urls = await client.getMailboxStackWriteUrlsForRepublish(accountPubkey)
          if (!urls.length) {
            throw new Error(t('No mailbox cache or HTTP write relays configured'))
          }
          const result = await client.publishEvent(urls, event, { skipOutboxRetry: true })
          if (result.successCount < 1) {
            throw new Error(t('No relay accepted the event'))
          }
          return result
        } finally {
          setBroadcastingKey(null)
        }
      })()
      toastPublishPromise(promise, {
        loading: t('Broadcasting to outbox HTTP and cache relays…'),
        success: () => t('Broadcast to mailbox stack finished'),
        error: (err) =>
          t('Failed to broadcast: {{error}}', {
            error: err instanceof Error ? err.message : String(err)
          })
      })
    },
    [accountPubkey, t]
  )

  /** Same predicate as full-text cache search — avoids hiding broadcast on valid rows that fail stricter checks. */
  const rowLooksLikeNostrEventForBroadcast = useCallback((v: unknown, storeName?: string | null): v is Event => {
    if (
      storeName === StoreNames.RSS_FEED_ITEMS ||
      storeName === StoreNames.RSS_FEED_LIST_EVENTS ||
      storeName === StoreNames.PIPER_TTS_CACHE
    ) {
      return false
    }
    return isLikelyCachedNostrEvent(v)
  }, [])

  const nostrEventHasPublishableSig = useCallback((e: Event): boolean => {
    return typeof e.sig === 'string' && e.sig.trim().length > 0
  }, [])

  const isInvalidEvent = useCallback(
    (item: { key: string; value: any; addedAt: number }, storeName?: string | null): boolean => {
      if (!item) return true
      if (
        storeName === StoreNames.RSS_FEED_ITEMS ||
        storeName === StoreNames.RSS_FEED_LIST_EVENTS
      ) {
        return true
      }
      if (storeName === StoreNames.PIPER_TTS_CACHE) {
        const v = item.value as { blob?: unknown; mimeType?: string } | null
        return !(v && typeof v.mimeType === 'string' && v.blob instanceof Blob)
      }
      if (!item.value) return true
      const event = item.value as Event
      if (!event.pubkey || typeof event.kind !== 'number' || typeof event.created_at !== 'number') return true
      if (!event.tags || !Array.isArray(event.tags)) return true
      if (!event.id || typeof event.sig !== 'string' || !event.sig.trim()) return true
      return false
    },
    []
  )

  const getInvalidEventExplanation = useCallback(
    (item: { key: string; value: any; addedAt: number }): string => {
      if (!item || !item.value) return t('Event has no value data')
      const event = item.value as Event
      const missing: string[] = []
      if (!event.pubkey) missing.push(t('pubkey'))
      if (typeof event.kind !== 'number') missing.push(t('kind'))
      if (typeof event.created_at !== 'number') missing.push(t('created_at'))
      if (!event.tags || !Array.isArray(event.tags)) missing.push(t('tags'))
      if (!event.id) missing.push(t('id'))
      if (typeof event.sig !== 'string' || !event.sig.trim()) missing.push(t('sig'))
      if (missing.length > 0) return t('Event is missing required fields: {{fields}}', { fields: missing.join(', ') })
      return t('Event appears to be invalid or corrupted')
    },
    [t]
  )

  const renderStoreListView = () => {
    if (Object.keys(cacheInfo).length === 0) {
      return <div className="text-sm text-muted-foreground">{t('No cached data found.')}</div>
    }
    const q = cachedEventsSearch.trim()
    if (q) {
      if (globalSearchLoading) {
        return (
          <div className="space-y-2 py-2" role="status" aria-busy="true" aria-label={t('Searching…')}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        )
      }
      if (globalSearchHits.length === 0) {
        return (
          <div className="text-sm text-muted-foreground">{t('No cached events match your search.')}</div>
        )
      }
      return (
        <div className="space-y-2">
          {globalSearchTruncated && (
            <p className="text-xs text-muted-foreground">
              {t('Showing first {{count}} cached event matches.', { count: GLOBAL_CACHED_EVENTS_SEARCH_LIMIT })}
            </p>
          )}
          {globalSearchHits.map((hit) => {
            const hitRowKey = `${hit.storeName}:${hit.key}:${hit.value.id}`
            const hitEvent = hit.value as Event
            const showBroadcast = rowLooksLikeNostrEventForBroadcast(hit.value, hit.storeName)
            const hasSig = nostrEventHasPublishableSig(hitEvent)
            const authorOk =
              !!accountPubkey && hitEvent.pubkey?.toLowerCase() === accountPubkey.toLowerCase()
            const broadcastDisabled =
              !accountPubkey || !authorOk || broadcastingKey !== null || !hasSig
            const broadcastTitle = !accountPubkey
              ? t('Log in to broadcast')
              : !hasSig
                ? t('Event must be signed to broadcast')
                : !authorOk
                  ? t('Only the author can broadcast this event')
                  : t('Publish this event to your NIP-65 outbox, HTTP write relays, and cache relays')
            return (
            <div
              key={hitRowKey}
              className="space-y-2 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="break-all font-medium text-foreground">{hit.storeName}</span>
                <span aria-hidden>·</span>
                <span>{t('Event kind label', { kind: hit.value.kind })}</span>
              </div>
              <div className="line-clamp-2 break-words text-xs">{hit.value.content || '\u00a0'}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  type="button"
                  onClick={() => void handleOpenSearchHit(hit)}
                >
                  {t('Open in store')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  type="button"
                  onClick={() => handleCopyItemJson({ value: hit.value })}
                  title={t('Copy event JSON')}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {t('Copy event JSON')}
                </Button>
                {showBroadcast && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    type="button"
                    disabled={broadcastDisabled}
                    title={broadcastTitle}
                    onClick={() => handleBroadcastToMailboxStack(hitEvent, hitRowKey)}
                  >
                    <Radio className="mr-1 h-3 w-3" />
                    {t('Broadcast to mailbox stack')}
                  </Button>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )
    }
    return Object.entries(cacheInfo)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([storeName, count]) => (
        <div
          key={storeName}
          className="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/50"
          onClick={() => handleStoreClick(storeName)}
        >
          <div className="break-words text-sm font-semibold">{storeName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {count} {t('items')}
          </div>
        </div>
      ))
  }

  const storeItemsSearch =
    selectedStore && !loadingItems ? (
      <div className="relative min-w-0 max-w-full shrink-0 px-1.5 py-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('Search items...')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-w-0 pl-8"
        />
      </div>
    ) : null

  const renderStoreItemsInner = () =>
    loadingItems ? (
      <div className="space-y-2 py-6" role="status" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    ) : (
      <>
        {storeItems.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('No items in this store.')}</div>
        ) : (
          <div className="min-w-0 max-w-full space-y-2">
            <div className="mb-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-muted-foreground">
                {filteredStoreItems.length} {t('of')} {storeItems.length} {t('items')}
                {selectedStore === StoreNames.PUBLICATION_EVENTS &&
                publicationStoreTotalRows != null &&
                publicationStoreTotalRows > storeItems.length
                  ? ` (${publicationStoreTotalRows} rows incl. nested sections)`
                  : ''}
                {searchQuery.trim() && ` ${t('matching')} "${searchQuery}"`}
              </div>
              <div className="flex min-w-0 flex-shrink-0 flex-wrap gap-2 sm:justify-end">
                <Button variant="outline" size="sm" onClick={handleCleanupDuplicates} className="h-7 text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {t('Cleanup Duplicates')}
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteAllItems} className="h-7 text-xs">
                  <Trash2 className="h-3 w-3 mr-1" />
                  {t('Delete All')}
                </Button>
              </div>
            </div>
            {filteredStoreItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('No items match your search.')}</div>
            ) : (
              filteredStoreItems.map((item, index) => {
                const nestedCount = (item as any).nestedCount
                const invalid = isInvalidEvent(item, selectedStore)
                const invalidExplanation = invalid ? getInvalidEventExplanation(item) : ''
                const showBroadcast = rowLooksLikeNostrEventForBroadcast(item.value, selectedStore)
                const rowEvent = item.value as Event
                const hasSig = nostrEventHasPublishableSig(rowEvent)
                const authorMatches =
                  !!accountPubkey && rowEvent.pubkey?.toLowerCase() === accountPubkey.toLowerCase()
                const broadcastDisabled =
                  !accountPubkey || !authorMatches || broadcastingKey !== null || !hasSig
                const broadcastTitle = !accountPubkey
                  ? t('Log in to broadcast')
                  : !hasSig
                    ? t('Event must be signed to broadcast')
                    : !authorMatches
                      ? t('Only the author can broadcast this event')
                      : t('Publish this event to your NIP-65 outbox, HTTP write relays, and cache relays')
                return (
                  <div
                    key={item.key || index}
                    className="relative min-w-0 max-w-full break-words rounded-lg border p-3"
                  >
                    <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md bg-background/90 pl-1 backdrop-blur-sm">
                      {invalid && (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
                              title={invalidExplanation}
                            >
                              <TriangleAlert className="h-3 w-3" />
                            </Button>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80">
                            <div className="space-y-2">
                              <div className="font-semibold text-sm flex items-center gap-2">
                                <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                                {t('Invalid Event')}
                              </div>
                              <div className="text-sm text-muted-foreground">{invalidExplanation}</div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      )}
                      {showBroadcast && (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => handleBroadcastToMailboxStack(rowEvent, item.key)}
                          disabled={broadcastDisabled}
                          className="h-6 w-6 p-0"
                          title={broadcastTitle}
                        >
                          <Radio className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => handleCopyItemJson(item)}
                        className="h-6 w-6 p-0"
                        title={t('Copy event JSON')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteItem(item.key)}
                        className="h-6 w-6 p-0"
                        title={t('Delete item')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div
                      className={`font-semibold text-xs mb-2 break-all ${invalid || showBroadcast ? 'pr-28' : 'pr-20'}`}
                    >
                      {item.key}
                      {typeof nestedCount === 'number' && nestedCount > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          ({nestedCount} {t('nested events')})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {t('Added at')}: {new Date(item.addedAt).toLocaleString()}
                    </div>
                    <pre
                      className={cn(
                        'max-h-96 min-w-0 max-w-full select-text overflow-auto rounded bg-muted p-2 text-xs',
                        wordWrapEnabled
                          ? 'break-words whitespace-pre-wrap [overflow-wrap:anywhere]'
                          : 'overflow-x-auto whitespace-pre'
                      )}
                    >
                      {JSON.stringify(item.value, null, 2)}
                    </pre>
                  </div>
                )
              })
            )}
          </div>
        )}
      </>
    )

  const browseCacheHeader = (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {selectedStore ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedStore(null)
                setStoreItems([])
              }}
            >
              ← {t('Back')}
            </Button>
            <span className="truncate text-sm font-medium">{selectedStore}</span>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 shrink-0" />
            {t('Browse Cache')}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setWordWrapEnabled(!wordWrapEnabled)}
        title={wordWrapEnabled ? t('Disable word wrap') : t('Enable word wrap')}
      >
        <WrapText className={`h-4 w-4 ${wordWrapEnabled ? '' : 'opacity-50'}`} />
      </Button>
    </div>
  )

  const browseCacheDescription = selectedStore
    ? t('View cached items in this store.')
    : t('Browse cache root description')

  /** Keep outside overflow-x-hidden ancestors so focus rings are not clipped (Firefox). */
  const storeListSearch = !selectedStore && Object.keys(cacheInfo).length > 0 && (
    <div className="relative min-w-0 max-w-full px-1.5 py-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={t('Search cached events...')}
        value={cachedEventsSearch}
        onChange={(e) => setCachedEventsSearch(e.target.value)}
        className="w-full min-w-0 pl-8"
        autoComplete="off"
      />
    </div>
  )

  /** Scrollable region only — search fields are siblings above this so focus rings are not clipped. */
  const scrollableListBody = (
    <div
      className={cn(
        'min-w-0 max-w-full space-y-4 pr-3 sm:pr-5',
        wordWrapEnabled && 'break-words'
      )}
    >
      {!selectedStore ? renderStoreListView() : renderStoreItemsInner()}
    </div>
  )

  return isSmallScreen ? (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex max-h-[90vh] flex-col">
        <DrawerHeader className="min-w-0 shrink-0">
          {browseCacheHeader}
          <DrawerTitle className="sr-only">{t('Browse Cache')}</DrawerTitle>
          <DrawerDescription>{browseCacheDescription}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-4 px-4 pb-4">
          {storeListSearch}
          {storeItemsSearch}
          <div className="max-h-[min(70vh,32rem)] min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto">
            {scrollableListBody}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(1000px,90vh)] w-[calc(100vw-1.5rem)] max-w-[min(1000px,calc(100vw-1.5rem))] min-w-0 flex-col gap-4 overflow-x-visible overflow-y-hidden sm:w-full sm:max-w-[1000px]">
        <DialogHeader className="min-w-0 shrink-0">
          {browseCacheHeader}
          <DialogTitle className="sr-only">{t('Browse Cache')}</DialogTitle>
          <DialogDescription>{browseCacheDescription}</DialogDescription>
        </DialogHeader>
        {storeListSearch}
        {storeItemsSearch}
        <div className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto">
          {scrollableListBody}
        </div>
      </DialogContent>
    </Dialog>
  )
}
