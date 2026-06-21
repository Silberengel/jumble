import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import logger from '@/lib/logger'
import { showPublishingError } from '@/lib/publishing-feedback'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useBookmarks } from '@/providers/bookmarks-context'
import { useNostr } from '@/providers/NostrProvider'
import { useNotificationThreadWatchOptional } from '@/providers/NotificationThreadWatchProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { dedupeFollowSetEventsByD } from '@/lib/follow-set-spell'
import client, { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { ExtendedKind, FIRST_RELAY_RESULT_GRACE_MS } from '@/constants'
import { filterEventsExcludingTombstones } from '@/lib/event'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { TOMBSTONES_UPDATED_EVENT } from '@/lib/tombstone-events'
import {
  buildSpellCatalogAuthors,
  getRelaysForSpellCatalogSync,
  getSpellName,
  isSpellEvent,
  SPELL_CATALOG_SYNC_LIMIT,
  SPELL_CATALOG_SYNC_LIMIT_WITH_FOLLOWS,
  SPELL_CATALOG_SYNC_TIMEOUT_MS
} from '@/services/spell.service'
import { ChevronDown, ChevronLeft, Copy, FileText, MoreVertical, Pencil, Plus, Star, Trash2, Wand2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSpellDialog from './CreateSpellDialog'
import ProfileInteractionsMap from './ProfileInteractionsMap'
import RelayThreadHeatMap from './RelayThreadHeatMap'
import type { TPageRef } from '@/types'
import {
  decodeFollowSetSpellId,
  decodeProfileInteractionsSpellId,
  fauxSpellLabelKey,
  getFollowSetDTag,
  isBuiltinFauxSpell,
  isFollowFeedFauxSpellId,
  isFollowSetSpellId,
  isFauxSpellPageParam,
  isProfileInteractionsSpellId,
  labelFollowSetEvent
} from './fauxSpellConfig'
import { SpellPickerContent } from './SpellPickerContent'
import { useSpellsPageFeed } from './useSpellsPageFeed'

const SpellsPage = forwardRef<TPageRef>(function SpellsPage(
  { spell: spellProp }: { spell?: string },
  ref
) {
  const { t } = useTranslation()
  const { navigate: navigatePrimary } = usePrimaryPage()
  const {
    pubkey,
    account,
    relayList,
    cacheRelayListEvent,
    attemptDelete,
    bookmarkListEvent,
    interestListEvent,
    followListEvent
  } = useNostr()
  const { addBookmark, removeBookmark } = useBookmarks()
  const notificationThreadWatch = useNotificationThreadWatchOptional()
  const eventsIFollowListEvent = notificationThreadWatch?.eventsIFollowListEvent ?? null
  const eventsIMutedListEvent = notificationThreadWatch?.eventsIMutedListEvent ?? null
  const { isSmallScreen } = useScreenSize()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const {
    showKinds: kindFilterShowKinds,
    showKind1OPs,
    showKind1Replies,
    showKind1111
  } = useKindFilterOrDefaults()
  const [spells, setSpells] = useState<Event[]>([])
  /** Ordered spell event ids (newest star first). Drives picker order + bookmark list sync when logged in. */
  const [favoriteSpellIds, setFavoriteSpellIds] = useState<string[]>([])
  const [selectedSpell, setSelectedSpell] = useState<Event | null>(null)
  const [selectedFauxSpell, setSelectedFauxSpell] = useState<string | null>(null)
  const [followSetListEvents, setFollowSetListEvents] = useState<Event[]>([])
  const [followSetCatalogLoading, setFollowSetCatalogLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [spellToEdit, setSpellToEdit] = useState<Event | null>(null)
  const [spellToClone, setSpellToClone] = useState<Event | null>(null)
  const [definitionSpell, setDefinitionSpell] = useState<Event | null>(null)
  const [contacts, setContacts] = useState<string[]>([])
  const contactsSyncKey = useMemo(() => [...contacts].sort().join(','), [contacts])
  /** True while fetching kind 777 authored by the user from write relays into IndexedDB */
  const [spellsCatalogSyncing, setSpellsCatalogSyncing] = useState(false)
  const spellCatalogCloserRef = useRef<(() => void) | null>(null)
  /** Bumps spell catalog relay re-sync when the user taps refresh in the titlebar. */
  const [spellCatalogManualRefreshKey, setSpellCatalogManualRefreshKey] = useState(0)
  /** Last processed {@link spellCatalogManualRefreshKey} so we only treat real bumps as “force sync”. */
  const spellCatalogLastManualKeyRef = useRef(0)
  const spellFeedListRef = useRef<TNoteListRef>(null)
  const selectedFauxSpellRefreshRef = useRef<string | null>(null)
  selectedFauxSpellRefreshRef.current = selectedFauxSpell
  const [heatMapRefreshKey, setHeatMapRefreshKey] = useState(0)
  const [profileInteractionsRefreshKey, setProfileInteractionsRefreshKey] = useState(0)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const [spellPickerOpen, setSpellPickerOpen] = useState(false)

  /** Monotonic token + wall time for spell-feed latency instrumentation (picker → first rows). */
  const spellFeedInstrTokenRef = useRef(0)
  const spellFeedInstrT0Ref = useRef(0)
  const spellFeedInstrLabelRef = useRef('')
  const [spellFeedInstrumentToken, setSpellFeedInstrumentToken] = useState(0)
  const [followSetManualRefreshKey, setFollowSetManualRefreshKey] = useState(0)
  /** Notifications `#p` + mention filter track the active session; changing the dropdown calls {@link switchAccount}. */
  const notificationsFeedPubkey = useMemo(() => {
    const cur = pubkey?.trim()
    return cur ? normalizeHexPubkey(cur) : null
  }, [pubkey])

  const logSpellFeedPickerSelection = useCallback((label: string, extra?: Record<string, unknown>) => {
    spellFeedInstrT0Ref.current = performance.now()
    spellFeedInstrLabelRef.current = label
    spellFeedInstrTokenRef.current += 1
    const instrumentToken = spellFeedInstrTokenRef.current
    setSpellFeedInstrumentToken(instrumentToken)
    logger.info('[SpellsPage] Spell feed — picker selection', {
      label,
      instrumentToken,
      ...extra
    })
  }, [])

  const urlFauxSpellInstrumentedRef = useRef<string | null>(null)
  /** Set when picker calls `navigatePrimary(..., { spell })` so URL effect does not log/bump token again. */
  const fauxSpellUrlSyncFromPickerRef = useRef<string | null>(null)
  useEffect(() => {
    if (spellProp === 'favorites' || spellProp === 'topicMap') {
      navigatePrimary('spells', { spell: 'heatMap' })
      return
    }
    if (spellProp && isFauxSpellPageParam(spellProp)) {
      if (fauxSpellUrlSyncFromPickerRef.current === spellProp) {
        fauxSpellUrlSyncFromPickerRef.current = null
        urlFauxSpellInstrumentedRef.current = spellProp
        setSelectedFauxSpell(spellProp)
        setSelectedSpell(null)
        return
      }
      if (urlFauxSpellInstrumentedRef.current === spellProp) return
      urlFauxSpellInstrumentedRef.current = spellProp
      logSpellFeedPickerSelection(`faux:${spellProp} (from URL)`, { fauxSpell: spellProp, fromUrl: true })
      setSelectedFauxSpell(spellProp)
      setSelectedSpell(null)
    } else {
      urlFauxSpellInstrumentedRef.current = null
      // URL / props no longer name a faux spell (e.g. bottom bar “Spells” → `/spells`) — leave the feed.
      setSelectedFauxSpell(null)
    }
  }, [spellProp, logSpellFeedPickerSelection, navigatePrimary])

  const loadSpells = useCallback(async () => {
    const [events, ids] = await Promise.all([
      indexedDb.getSpellEvents(),
      indexedDb.getSpellFavoriteIds()
    ])
    setSpells(events)
    setFavoriteSpellIds(ids)
  }, [])

  const refreshSpellsFeedAndCatalog = useCallback(() => {
    void loadSpells()
    if (pubkey) {
      setSpellCatalogManualRefreshKey((k) => k + 1)
      setFollowSetManualRefreshKey((k) => k + 1)
    }
    if (selectedFauxSpellRefreshRef.current === 'heatMap') {
      setHeatMapRefreshKey((k) => k + 1)
    }
    if (isProfileInteractionsSpellId(selectedFauxSpellRefreshRef.current)) {
      setProfileInteractionsRefreshKey((k) => k + 1)
    }
    spellFeedListRef.current?.refresh()
  }, [loadSpells, pubkey])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: refreshSpellsFeedAndCatalog
    }),
    [refreshSpellsFeedAndCatalog]
  )

  const {
    relayMailboxStableKey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    subRequests,
    spellFeedSubscriptionKey,
    spellBrowseRelayUrlsKey,
    showKinds,
    fauxNoteListUseFilterAsIs,
    spellFauxMergeTimeline,
    notificationsMentionExtraHide,
    fauxSubRequests,
    followingFeedPreparing,
    NOTIFICATION_SPELL_LOADING_SAFETY_MS,
    NOTIFICATION_SPELL_KINDS
  } = useSpellsPageFeed({
    selectedFauxSpell,
    selectedSpell,
    pubkey,
    relayList,
    cacheRelayListEvent,
    favoriteRelays,
    blockedRelays,
    notificationsFeedPubkey,
    interestListEvent,
    bookmarkListEvent,
    followListEvent,
    contacts,
    contactsSyncKey,
    followSetListEvents,
    followSetCatalogLoading,
    kindFilterShowKinds,
    notificationEventsIFollowListEvent: eventsIFollowListEvent,
    notificationEventsIMutedListEvent: eventsIMutedListEvent
  })

  useEffect(() => {
    if (!pubkey) {
      setFollowSetListEvents([])
      setFollowSetCatalogLoading(false)
      return
    }
    let cancelled = false
    setFollowSetCatalogLoading(true)
    void (async () => {
      try {
        const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
          favoriteRelays,
          blockedRelays,
          userReadInboxUrls(relayList, cacheRelayListEvent),
          { userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent) }
        )
        if (!feedUrls.length) {
          if (!cancelled) setFollowSetListEvents([])
          return
        }
        const [events, tombstones] = await Promise.all([
          queryService.fetchEvents(
            feedUrls,
            { authors: [pubkey], kinds: [ExtendedKind.FOLLOW_SET], limit: 500 },
            { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
          ),
          indexedDb.getAllTombstones()
        ])
        if (!cancelled) {
          setFollowSetListEvents(dedupeFollowSetEventsByD(filterEventsExcludingTombstones(events, tombstones)))
        }
      } catch {
        if (!cancelled) setFollowSetListEvents([])
      } finally {
        if (!cancelled) setFollowSetCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, sortedFavoriteRelaysKey, sortedBlockedRelaysKey, relayMailboxStableKey, followSetManualRefreshKey, favoriteRelays, blockedRelays, relayList])

  useEffect(() => {
    const onTombstones = () => setFollowSetManualRefreshKey((k) => k + 1)
    window.addEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
    return () => window.removeEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
  }, [])

  /**
   * Kind-777 list for the dropdown. When opening with `?spell=…` (faux name, hex id, nevent, etc.), defer
   * this IndexedDB read so the feed can subscribe and paint first; the header already reflects the URL.
   */
  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (!cancelled) void loadSpells()
    }
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (spellProp?.trim()) {
      if (typeof requestIdleCallback !== 'undefined') {
        idleId = requestIdleCallback(run, { timeout: 400 })
      } else {
        timeoutId = setTimeout(run, 0)
      }
    } else {
      run()
    }

    return () => {
      cancelled = true
      if (idleId !== undefined) cancelIdleCallback(idleId)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [loadSpells, spellProp])

  /**
   * Pull kind 777 from relays only when IndexedDB has no spells yet, or when the user requests refresh.
   * Otherwise the picker uses {@link loadSpells} from cache only (no extra REQ on each visit / relay churn).
   */
  useEffect(() => {
    if (!pubkey) {
      setSpellsCatalogSyncing(false)
      return
    }
    let cancelled = false
    spellCatalogCloserRef.current = null
    let loadSpellsDebounce: ReturnType<typeof setTimeout> | null = null
    let delayId: ReturnType<typeof setTimeout> | null = null
    let syncTimeout: ReturnType<typeof setTimeout> | null = null
    let afterFirstBatchTimer: ReturnType<typeof setTimeout> | null = null
    const clearAfterFirstBatchTimer = () => {
      if (afterFirstBatchTimer != null) {
        clearTimeout(afterFirstBatchTimer)
        afterFirstBatchTimer = null
      }
    }

    const scheduleLoadSpells = () => {
      if (loadSpellsDebounce != null) clearTimeout(loadSpellsDebounce)
      loadSpellsDebounce = setTimeout(() => {
        loadSpellsDebounce = null
        if (!cancelled) void loadSpells()
      }, 120)
    }

    void (async () => {
      const manualBump = spellCatalogManualRefreshKey !== spellCatalogLastManualKeyRef.current
      if (manualBump) {
        spellCatalogLastManualKeyRef.current = spellCatalogManualRefreshKey
      }

      /** Avoid relay catalog SUB on every Spells visit; sync when the picker opens or user refreshes. */
      if (!manualBump && !spellPickerOpen) {
        return
      }

      const idbSpellsP = indexedDb.getSpellEvents()
      if (!manualBump) {
        const cachedSpells = await idbSpellsP
        if (cancelled) return
        if (cachedSpells.length > 0) {
          return
        }
      }

      const urls = getRelaysForSpellCatalogSync(favoriteRelays, blockedRelays, userReadInboxUrls(relayList, cacheRelayListEvent), {
        userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent),
        useGlobalRelayBootstrap
      })
      const catalogAuthors = buildSpellCatalogAuthors(pubkey, contacts)
      const authorAllowlist = new Set(catalogAuthors)
      const filter = {
        kinds: [ExtendedKind.SPELL],
        authors: catalogAuthors,
        limit: contacts.length > 0 ? SPELL_CATALOG_SYNC_LIMIT_WITH_FOLLOWS : SPELL_CATALOG_SYNC_LIMIT
      }

      syncTimeout = setTimeout(() => {
        if (cancelled) return
        logger.warn('[SpellsPage] Spell catalog sync timed out')
        spellCatalogCloserRef.current?.()
        spellCatalogCloserRef.current = null
        setSpellsCatalogSyncing(false)
      }, SPELL_CATALOG_SYNC_TIMEOUT_MS)

      let catalogSyncDone = false

      /** Catalog sync runs in parallel with the open feed; avoid an artificial delay. */
      const catalogDelayMs = 0
      if (cancelled) return
      delayId = setTimeout(() => {
        if (cancelled) return
        void (async () => {
          try {
            setSpellsCatalogSyncing(true)
            const { closer } = await client.subscribeTimeline(
              [{ urls, filter }],
              {
                onEvents: async (events, eosed) => {
                  if (cancelled) return
                  let wrote = false
                  for (const ev of events) {
                    if (cancelled) return
                    if (!verifyEvent(ev) || !isSpellEvent(ev) || !authorAllowlist.has(ev.pubkey)) continue
                    try {
                      await indexedDb.putSpellEvent(ev)
                      wrote = true
                    } catch (e) {
                      logger.warn('[SpellsPage] Failed to cache spell from relay', e)
                    }
                  }
                  if (wrote) scheduleLoadSpells()
                  if (wrote && afterFirstBatchTimer == null) {
                    afterFirstBatchTimer = setTimeout(() => {
                      afterFirstBatchTimer = null
                      if (cancelled || catalogSyncDone) return
                      catalogSyncDone = true
                      if (syncTimeout != null) clearTimeout(syncTimeout)
                      if (loadSpellsDebounce != null) {
                        clearTimeout(loadSpellsDebounce)
                        loadSpellsDebounce = null
                      }
                      void (async () => {
                        if (!cancelled) await loadSpells()
                        if (!cancelled) setSpellsCatalogSyncing(false)
                      })()
                      closer()
                      spellCatalogCloserRef.current = null
                    }, FIRST_RELAY_RESULT_GRACE_MS)
                  }
                  if (eosed) {
                    clearAfterFirstBatchTimer()
                    if (cancelled || catalogSyncDone) return
                    catalogSyncDone = true
                    if (syncTimeout != null) clearTimeout(syncTimeout)
                    if (loadSpellsDebounce != null) {
                      clearTimeout(loadSpellsDebounce)
                      loadSpellsDebounce = null
                    }
                    if (!cancelled) await loadSpells()
                    if (!cancelled) setSpellsCatalogSyncing(false)
                    closer()
                    spellCatalogCloserRef.current = null
                  }
                },
                onNew: () => {} // Not needed
              },
              {
                firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS
              }
            )
            if (cancelled) {
              closer()
              return
            }
            spellCatalogCloserRef.current = closer
          } catch (e) {
            if (syncTimeout != null) clearTimeout(syncTimeout)
            logger.warn('[SpellsPage] Spell catalog subscribe failed', e)
            if (!cancelled) setSpellsCatalogSyncing(false)
          }
        })()
      }, catalogDelayMs)
    })()

    return () => {
      cancelled = true
      clearAfterFirstBatchTimer()
      if (delayId != null) clearTimeout(delayId)
      if (syncTimeout != null) clearTimeout(syncTimeout)
      if (loadSpellsDebounce != null) clearTimeout(loadSpellsDebounce)
      spellCatalogCloserRef.current?.()
      spellCatalogCloserRef.current = null
      setSpellsCatalogSyncing(false)
    }
  }, [
    pubkey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    relayMailboxStableKey,
    loadSpells,
    contactsSyncKey,
    spellCatalogManualRefreshKey,
    spellPickerOpen,
    useGlobalRelayBootstrap
  ])

  useEffect(() => {
    if (!pubkey) {
      setContacts([])
      return
    }
    client.fetchFollowings(pubkey).then(setContacts).catch(() => setContacts([]))
  }, [pubkey])

  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  useEffect(() => {
    if (!spellBrowseRelayUrlsKey) return
    const urls = spellBrowseRelayUrlsKey.split('|')
    addRelayUrls(urls)
    return () => removeRelayUrls(urls)
  }, [spellBrowseRelayUrlsKey, addRelayUrls, removeRelayUrls])

  const favoriteSpellSet = useMemo(
    () => new Set(favoriteSpellIds.map((id) => id.toLowerCase())),
    [favoriteSpellIds]
  )

  const toggleFavoriteSpell = useCallback(
    async (spell: Event) => {
      const sid = spell.id
      const sidLower = sid.toLowerCase()
      const ids = await indexedDb.getSpellFavoriteIds()
      const exists = ids.some((id) => id.toLowerCase() === sidLower)
      if (!exists) {
        if (pubkey) {
          try {
            await addBookmark(spell)
          } catch (e) {
            logger.error('[SpellsPage] addBookmark for starred spell failed', e)
            showPublishingError(e instanceof Error ? e : new Error(String(e)))
            return
          }
        }
        const next = [sid, ...ids.filter((id) => id.toLowerCase() !== sidLower)]
        await indexedDb.setSpellFavoriteIds(next)
        setFavoriteSpellIds(next)
        return
      }
      if (pubkey) {
        try {
          await removeBookmark(spell)
        } catch (e) {
          logger.error('[SpellsPage] removeBookmark for starred spell failed', e)
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
          return
        }
      }
      const next = ids.filter((id) => id.toLowerCase() !== sidLower)
      await indexedDb.setSpellFavoriteIds(next)
      setFavoriteSpellIds(next)
    },
    [pubkey, addBookmark, removeBookmark]
  )

  const handleDeleteSpell = useCallback(
    async (spell: Event) => {
      try {
        await attemptDelete(spell)
      } catch (e) {
        logger.error('Spell deletion publish failed', { error: e, spellId: spell.id })
        showPublishingError(e instanceof Error ? e : new Error(String(e)))
        return
      }
      try {
        await indexedDb.deleteSpellEvent(spell.id)
        const ids = await indexedDb.getSpellFavoriteIds()
        const wasStarred = ids.some((id) => id.toLowerCase() === spell.id.toLowerCase())
        if (pubkey && wasStarred) {
          try {
            await removeBookmark(spell)
          } catch (e) {
            logger.warn('[SpellsPage] removeBookmark after spell delete failed', e)
          }
        }
        await indexedDb.setSpellFavoriteIds(ids.filter((id) => id.toLowerCase() !== spell.id.toLowerCase()))
        if (selectedSpell?.id === spell.id) setSelectedSpell(null)
        await loadSpells()
      } catch (e) {
        logger.error('Spell local cleanup after delete failed', { error: e, spellId: spell.id })
        showPublishingError(
          e instanceof Error ? e : new Error(t('Failed to remove spell from local storage'))
        )
      }
    },
    [attemptDelete, loadSpells, pubkey, removeBookmark, selectedSpell?.id, t]
  )

  const starredSpellsForPicker = useMemo(() => {
    const byId = new Map<string, Event>()
    for (const s of spells) {
      byId.set(s.id.toLowerCase(), s)
    }
    return favoriteSpellIds
      .map((id) => byId.get(id.toLowerCase()))
      .filter((s): s is Event => s != null)
  }, [spells, favoriteSpellIds])

  const { ownSpells, followSpells, otherSpells, spellsForSelect } = useMemo(() => {
    const byName = (a: Event, b: Event) =>
      getSpellName(a).localeCompare(getSpellName(b), undefined, { sensitivity: 'base' })

    const followSet = new Set(contacts)
    const own: Event[] = []
    const follow: Event[] = []
    const other: Event[] = []

    for (const s of spells) {
      if (favoriteSpellSet.has(s.id.toLowerCase())) continue
      if (pubkey && s.pubkey === pubkey) own.push(s)
      else if (followSet.has(s.pubkey)) follow.push(s)
      else other.push(s)
    }

    own.sort(byName)
    follow.sort(byName)
    other.sort(byName)

    return {
      ownSpells: own,
      followSpells: follow,
      otherSpells: other,
      spellsForSelect: [...own, ...follow, ...other]
    }
  }, [spells, pubkey, contacts, favoriteSpellSet])

  const spellMenuLabel = useCallback(
    (spell: Event) =>
      favoriteSpellSet.has(spell.id.toLowerCase()) ? `★ ${getSpellName(spell)}` : getSpellName(spell),
    [favoriteSpellSet]
  )

  const selectedFauxSpellDisplayLabel = useMemo(() => {
    if (!selectedFauxSpell) return ''
    if (isProfileInteractionsSpellId(selectedFauxSpell)) {
      return t('Interactions map')
    }
    if (isFollowSetSpellId(selectedFauxSpell)) {
      const d = decodeFollowSetSpellId(selectedFauxSpell)
      if (!d) return t('Follow set')
      const ev = followSetListEvents.find((e) => getFollowSetDTag(e) === d)
      return ev ? labelFollowSetEvent(ev) : d
    }
    if (isBuiltinFauxSpell(selectedFauxSpell)) {
      return t(fauxSpellLabelKey(selectedFauxSpell))
    }
    return selectedFauxSpell
  }, [selectedFauxSpell, followSetListEvents, t])

  const spellsTitlebarTitle = useMemo(() => {
    if (selectedFauxSpell) return selectedFauxSpellDisplayLabel
    if (selectedSpell) return spellMenuLabel(selectedSpell)
    return t('Spells')
  }, [selectedFauxSpell, selectedSpell, selectedFauxSpellDisplayLabel, spellMenuLabel, t])

  const pickSpell = useCallback(
    (spell: Event | null) => {
      setSpellPickerOpen(false)
      if (spell && selectedSpell?.id === spell.id && !selectedFauxSpell) {
        return
      }
      if (spell) {
        logSpellFeedPickerSelection(`kind777:${getSpellName(spell)}`, {
          spellId: spell.id,
          spellAuthorPubkey: spell.pubkey,
          kind777: true
        })
      }
      setSelectedSpell(spell)
      setSelectedFauxSpell(null)
      navigatePrimary('spells')
    },
    [logSpellFeedPickerSelection, navigatePrimary, selectedSpell?.id, selectedFauxSpell]
  )

  const clearSpellSelection = useCallback(() => {
    logSpellFeedPickerSelection('(cleared)', { cleared: true })
    setSelectedSpell(null)
    setSelectedFauxSpell(null)
    setSpellPickerOpen(false)
    navigatePrimary('spells')
  }, [logSpellFeedPickerSelection, navigatePrimary])

  const pickFauxSpell = useCallback(
    (name: string | null) => {
      setSpellPickerOpen(false)
      if (name) {
        if (!isFauxSpellPageParam(name)) return
        // Re-selecting the same built-in feed from the picker should not clear + resubscribe (toggle used to call
        // pickFauxSpell(null) and wipe the timeline when the row was already selected).
        if (selectedFauxSpell === name && selectedSpell === null) {
          return
        }
        logSpellFeedPickerSelection(`faux:${name}`, { fauxSpell: name })
        fauxSpellUrlSyncFromPickerRef.current = name
        setSelectedFauxSpell(name)
        setSelectedSpell(null)
        navigatePrimary('spells', { spell: name })
      } else {
        logSpellFeedPickerSelection('(cleared faux)', { clearedFaux: true })
        fauxSpellUrlSyncFromPickerRef.current = null
        setSelectedFauxSpell(null)
        setSelectedSpell(null)
        navigatePrimary('spells')
      }
    },
    [logSpellFeedPickerSelection, navigatePrimary, selectedFauxSpell, selectedSpell]
  )

  const canSignSpellActions = account != null && account.signerType !== 'npub'
  const selectedSpellIsAuthor = !!(pubkey && selectedSpell && selectedSpell.pubkey === pubkey)
  const selectedSpellCanEditOrDelete = selectedSpellIsAuthor && canSignSpellActions

  const handleSpellFeedFirstPaint = useCallback(
    (detail: { eventCount: number; firstEventId: string }) => {
      const elapsedMsSincePickerMs = Math.round(performance.now() - spellFeedInstrT0Ref.current)
      logger.info('[SpellsPage] Spell feed — first events rendered (list has rows)', {
        ...detail,
        eventCountMeaning: 'filtered visible rows (slice), not full relay buffer',
        elapsedMsSincePickerMs,
        selectionLabel: spellFeedInstrLabelRef.current,
        instrumentToken: spellFeedInstrTokenRef.current
      })
    },
    []
  )

  const fauxFeedEmptyMessage = useMemo(() => {
    if (!selectedFauxSpell || fauxSubRequests.length > 0) return null
    if (selectedFauxSpell === 'interests') return t('No subscribed interests yet.')
    if (selectedFauxSpell === 'bookmarks')
      return t('No NIP-51 bookmarks or web bookmarks yet.')
    if (selectedFauxSpell === 'following') return t('No follows or relays to load yet.')
    if (isFollowSetSpellId(selectedFauxSpell)) return t('Follow set feed empty')
    return t('Nothing to load for this feed.')
  }, [selectedFauxSpell, fauxSubRequests.length, t])

  const spellStarAddTitle = t('Spell star add title')
  const spellStarRemoveTitle = t('Spell star remove title')

  const spellPickerPanel = useMemo(
    () => (
      <SpellPickerContent
        t={t}
        pubkey={pubkey}
        selectedSpell={selectedSpell}
        selectedFauxSpell={selectedFauxSpell}
        favoriteSpellSet={favoriteSpellSet}
        starredSpellsForPicker={starredSpellsForPicker}
        ownSpells={ownSpells}
        followSpells={followSpells}
        otherSpells={otherSpells}
        followSetListEvents={followSetListEvents}
        spellMenuLabel={spellMenuLabel}
        spellStarAddTitle={spellStarAddTitle}
        spellStarRemoveTitle={spellStarRemoveTitle}
        pickSpell={pickSpell}
        pickFauxSpell={pickFauxSpell}
        clearSpellSelection={clearSpellSelection}
        toggleFavoriteSpell={toggleFavoriteSpell}
      />
    ),
    [
      t,
      pubkey,
      selectedSpell,
      selectedFauxSpell,
      favoriteSpellSet,
      starredSpellsForPicker,
      ownSpells,
      followSpells,
      otherSpells,
      followSetListEvents,
      spellMenuLabel,
      spellStarAddTitle,
      spellStarRemoveTitle,
      pickSpell,
      pickFauxSpell,
      clearSpellSelection,
      toggleFavoriteSpell
    ]
  )

  const spellPickerTriggerButton = (
    <Button
      type="button"
      variant="outline"
      className="min-w-0 flex-1 justify-between font-normal sm:max-w-md"
      title={
        selectedFauxSpell
          ? selectedFauxSpellDisplayLabel
          : selectedSpell
            ? spellMenuLabel(selectedSpell)
            : undefined
      }
      aria-expanded={spellPickerOpen}
    >
      <span className="truncate">
        {selectedFauxSpell
          ? selectedFauxSpellDisplayLabel
          : selectedSpell
            ? spellMenuLabel(selectedSpell)
            : t('Select a spell…')}
      </span>
      <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
    </Button>
  )

  const spellsSubHeader = (
    <div className="flex flex-col gap-2 px-4 py-2.5 sm:px-4">
      {selectedFauxSpell ? (
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-2 h-9 text-muted-foreground hover:text-foreground"
            onClick={clearSpellSelection}
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            <span>{t('Spells')}</span>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            {isSmallScreen ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-0 flex-1 justify-between font-normal sm:max-w-md"
                  title={selectedSpell ? spellMenuLabel(selectedSpell) : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={spellPickerOpen}
                  onClick={() => setSpellPickerOpen(true)}
                >
                  <span className="truncate">
                    {selectedSpell ? spellMenuLabel(selectedSpell) : t('Select a spell…')}
                  </span>
                  <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
                </Button>
                <Drawer open={spellPickerOpen} onOpenChange={setSpellPickerOpen}>
                  <DrawerContent className="flex max-h-[min(92dvh,40rem)] flex-col gap-0 p-0 sm:max-h-[75vh]">
                    <DrawerHeader className="shrink-0 space-y-0 border-b px-4 py-3 text-left">
                      <DrawerTitle className="text-base">{t('Select a spell…')}</DrawerTitle>
                    </DrawerHeader>
                    <div
                      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
                      role="listbox"
                      aria-label={t('Select a spell…')}
                    >
                      {spellPickerPanel}
                    </div>
                  </DrawerContent>
                </Drawer>
              </>
            ) : (
              <DropdownMenu open={spellPickerOpen} onOpenChange={setSpellPickerOpen}>
                <DropdownMenuTrigger asChild aria-haspopup="menu">
                  {spellPickerTriggerButton}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="bottom"
                  showScrollButtons
                  className="max-h-[min(75vh,40rem)] w-[var(--radix-dropdown-menu-trigger-width)] max-w-md p-0"
                >
                  <div className="sticky top-0 z-10 border-b bg-popover px-3 py-2 text-left text-sm font-semibold">
                    {t('Select a spell…')}
                  </div>
                  <div className="px-1 py-2" role="listbox" aria-label={t('Select a spell…')}>
                    {spellPickerPanel}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                className="justify-start gap-2"
                variant="outline"
                onClick={() => {
                  setSpellToEdit(null)
                  setSpellToClone(null)
                  setCreateOpen(true)
                }}
              >
                <Wand2 className="size-4" />
                {t('Create a Spell')}
              </Button>
              {selectedSpell && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    title={
                      favoriteSpellSet.has(selectedSpell.id.toLowerCase())
                        ? t('Spell star remove title')
                        : t('Spell star add title')
                    }
                    onClick={() => void toggleFavoriteSpell(selectedSpell)}
                  >
                    <Star
                      className={`size-4 ${favoriteSpellSet.has(selectedSpell.id.toLowerCase()) ? 'fill-amber-400 text-amber-500' : ''}`}
                    />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0" title={t('More options')}>
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {selectedSpellCanEditOrDelete ? (
                        <DropdownMenuItem
                          className="gap-2"
                          onClick={() => {
                            setSpellToClone(null)
                            setSpellToEdit(selectedSpell)
                            setCreateOpen(true)
                          }}
                        >
                          <Pencil className="size-4" />
                          {t('Edit spell')}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          className="gap-2"
                          onClick={() => {
                            setSpellToEdit(null)
                            setSpellToClone(selectedSpell)
                            setCreateOpen(true)
                          }}
                        >
                          <Copy className="size-4" />
                          {t('Clone spell')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="gap-2" onClick={() => setDefinitionSpell(selectedSpell)}>
                        <FileText className="size-4" />
                        {t('View definition')}
                      </DropdownMenuItem>
                      {selectedSpellCanEditOrDelete ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="gap-2 text-destructive focus:text-destructive"
                            onClick={() => handleDeleteSpell(selectedSpell)}
                          >
                            <Trash2 className="size-4" />
                            {t('Delete')}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>

          {spellsCatalogSyncing ? (
            <p className="text-xs text-muted-foreground">{t('Loading spells from your relays…')}</p>
          ) : null}

          {spellsForSelect.length === 0 && !spellsCatalogSyncing && (
            <p className="text-sm text-muted-foreground">{t('No spells yet. Create one with the button above.')}</p>
          )}
        </>
      )}
    </div>
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="spells"
      titlebar={
        <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
          <div
            className="app-chrome-title min-w-0 flex-1 truncate pl-3"
            title={spellsTitlebarTitle}
          >
            {spellsTitlebarTitle}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RefreshButton onClick={refreshSpellsFeedAndCatalog} />
            <Button
              variant="ghost"
              size="titlebar-icon"
              onClick={() => {
                setSpellToEdit(null)
                setSpellToClone(null)
                setCreateOpen(true)
              }}
              title={t('Create a Spell')}
            >
              <Plus className="size-5" />
            </Button>
          </div>
        </div>
      }
      subHeader={spellsSubHeader}
      displayScrollToTopButton
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 pt-2">
        {/* Feed — faux spells and kind-777 spells all use NoteList */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedFauxSpell === 'notifications' && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please log in to view notifications.')}
            </div>
          ) : isFollowFeedFauxSpellId(selectedFauxSpell ?? '') && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please login to view following feed')}
            </div>
          ) : selectedFauxSpell === 'bookmarks' && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please login to view bookmarks')}
            </div>
          ) : selectedFauxSpell === 'heatMap' && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please login to view thread heat map')}
            </div>
          ) : selectedFauxSpell === 'heatMap' && pubkey ? (
            <div className="min-h-0 min-w-0 flex-1">
              <RelayThreadHeatMap followPubkeys={contacts} refreshKey={heatMapRefreshKey} />
            </div>
          ) : isProfileInteractionsSpellId(selectedFauxSpell) ? (
            <div className="min-h-0 min-w-0 flex-1">
              <ProfileInteractionsMap
                pubkey={decodeProfileInteractionsSpellId(selectedFauxSpell)!}
                refreshKey={profileInteractionsRefreshKey}
              />
            </div>
          ) : selectedFauxSpell && followingFeedPreparing ? (
            <div className="space-y-2 px-1 py-8" role="status" aria-busy="true" aria-live="polite">
              <p className="text-center text-sm text-muted-foreground">
                {t('Loading recent posts from follows…')}
              </p>
              {Array.from({ length: 5 }).map((_, i) => (
                <NoteCardLoadingSkeleton key={i} />
              ))}
            </div>
          ) : selectedFauxSpell && fauxSubRequests.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{fauxFeedEmptyMessage}</div>
          ) : selectedFauxSpell && fauxSubRequests.length > 0 ? (
              <div className="min-h-0 min-w-0 flex-1">
                <NoteList
                  ref={spellFeedListRef}
                  subRequests={subRequests}
                  feedSubscriptionKey={spellFeedSubscriptionKey}
                  hostPrimaryPageName="spells"
                  preserveTimelineOnSubRequestsChange={
                    spellFauxMergeTimeline || selectedFauxSpell === 'notifications'
                  }
                  mergeTimelineWhenSubRequestFiltersMatch={
                    spellFauxMergeTimeline || selectedFauxSpell === 'notifications'
                  }
                  mergeLiveEventsImmediately={selectedFauxSpell === 'notifications'}
                  showKinds={
                    selectedFauxSpell === 'notifications' ? NOTIFICATION_SPELL_KINDS : showKinds
                  }
                  spellFeedInstrumentToken={spellFeedInstrumentToken}
                  onSpellFeedFirstPaint={handleSpellFeedFirstPaint}
                  timelineLoadingSafetyTimeoutMs={
                    selectedFauxSpell === 'notifications'
                      ? NOTIFICATION_SPELL_LOADING_SAFETY_MS
                      : undefined
                  }
                  clientSideKindFilter={
                    selectedFauxSpell === 'notifications' || selectedFauxSpell === 'bookmarks'
                  }
                  useFilterAsIs={fauxNoteListUseFilterAsIs}
                  oneShotFetch={false}
                  showKind1OPs={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1OPs
                      : true
                  }
                  showKind1Replies={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1Replies
                      : true
                  }
                  showKind1111={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1111
                      : true
                  }
                  hideReplies={false}
                  extraShouldHideEvent={
                    selectedFauxSpell === 'notifications' && notificationsFeedPubkey
                      ? notificationsMentionExtraHide
                      : undefined
                  }
                  showPaymentAttestationAction={selectedFauxSpell === 'notifications'}
                  incomingPaymentRecipientPubkey={
                    selectedFauxSpell === 'notifications' ? notificationsFeedPubkey : null
                  }
                />
              </div>
          ) : selectedSpell ? (
            subRequests.length > 0 ? (
              <NoteList
                ref={spellFeedListRef}
                subRequests={subRequests}
                feedSubscriptionKey={spellFeedSubscriptionKey}
                hostPrimaryPageName="spells"
                showKinds={showKinds}
                spellFeedInstrumentToken={spellFeedInstrumentToken}
                onSpellFeedFirstPaint={handleSpellFeedFirstPaint}
                useFilterAsIs
              />
            ) : !pubkey &&
              selectedSpell.tags.some(
                (tag) => tag[0] === 'authors' && (tag.includes('$me') || tag.includes('$contacts'))
              ) ? (
              <div className="py-8 text-center text-muted-foreground">
                {t('Log in to run this spell (it uses $me or $contacts).')}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                {t(
                  'Could not run this spell. Check that it has a valid REQ/COUNT command, or add write relays in settings.'
                )}
              </div>
            )
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              {t('Select a spell to view its feed.')}
            </div>
          )}
        </div>
      </div>

      <CreateSpellDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setSpellToEdit(null)
            setSpellToClone(null)
          }
        }}
        spellToEdit={spellToEdit}
        spellToClone={spellToClone}
        onSaved={(ev) => {
          void loadSpells()
          if (ev && spellToEdit && selectedSpell?.id === spellToEdit.id) {
            setSelectedSpell(ev)
          }
          if (ev && spellToClone && selectedSpell?.id === spellToClone.id) {
            setSelectedSpell(ev)
          }
        }}
      />

      <Dialog open={!!definitionSpell} onOpenChange={(open) => !open && setDefinitionSpell(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {definitionSpell ? getSpellName(definitionSpell) : t('Spell definition')}
            </DialogTitle>
          </DialogHeader>
          {definitionSpell && (
            <div className="space-y-4 text-sm">
              {definitionSpell.content?.trim() && (
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">{t('Description')}</div>
                  <p className="whitespace-pre-wrap break-words">{definitionSpell.content.trim()}</p>
                </div>
              )}
              <div>
                <div className="mb-2 font-medium text-muted-foreground">{t('Tags')}</div>
                <dl className="space-y-1.5 font-mono text-xs">
                  {definitionSpell.tags.map((tag, i) => (
                    <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="shrink-0 text-muted-foreground">{tag[0]}:</dt>
                      <dd className="min-w-0 break-all">
                        {tag.length > 1 ? tag.slice(1).join(', ') : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="overflow-wrap-anywhere break-words text-xs text-muted-foreground">
                <span className="font-medium">id:</span> <span className="break-all">{definitionSpell.id}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PrimaryPageLayout>
  )
})

export default SpellsPage
