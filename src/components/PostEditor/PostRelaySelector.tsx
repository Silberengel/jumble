import { isSocialKindBlockedKind, MAX_PUBLISH_RELAYS, SOCIAL_KIND_BLOCKED_RELAY_URLS } from '@/constants'
import { NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX } from '@/lib/content-patterns'
import { simplifyUrl, isLocalNetworkUrl, normalizeRelayUrlByScheme } from '@/lib/url'
import { collectViewerWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { userReadInboxUrls } from '@/lib/favorites-feed-relays'
import { Check, ChevronDown, Server } from 'lucide-react'
import { NostrEvent } from 'nostr-tools'
import { Dispatch, SetStateAction, useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import relaySelectionService, { type RelaySourceType } from '@/services/relay-selection.service'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import logger from '@/lib/logger'
import { computePrePublishRelayCapPreview, type TPrePublishRelayCapPreview } from '@/lib/pre-publish-relay-cap'

/** Stable default when `mentions` is omitted — inline `= []` is a new array every render and retriggers effects. */
const NO_MENTIONS: string[] = []

/** Keep auto-selection within {@link MAX_PUBLISH_RELAYS}, preserving {@link selectableRelaysOrder} (top of list first). */
function capAutoSelectedRelays(selectableRelaysOrder: string[], selectedWithCache: string[]): string[] {
  const norm = (u: string) => normalizeRelayUrlByScheme(u) || u
  const selectedNormSet = new Set(selectedWithCache.map(norm))
  const ordered: string[] = []
  for (const url of selectableRelaysOrder) {
    if (selectedNormSet.has(norm(url))) ordered.push(url)
  }
  for (const url of selectedWithCache) {
    if (!ordered.some((u) => norm(u) === norm(url))) ordered.push(url)
  }
  return ordered.slice(0, MAX_PUBLISH_RELAYS)
}

export default function PostRelaySelector({
  parentEvent: _parentEvent,
  openFrom,
  setIsProtectedEvent,
  setAdditionalRelayUrls,
  onRelayPublishCapChange,
  content: postContent = '',
  isPublicMessage = false,
  mentions = NO_MENTIONS
}: {
  parentEvent?: NostrEvent
  openFrom?: string[]
  setIsProtectedEvent: Dispatch<SetStateAction<boolean>>
  setAdditionalRelayUrls: Dispatch<SetStateAction<string[]>>
  /** Notifies the post form when the relay cap prevents honoring every checked relay (so the form can disable publish and show a banner). */
  onRelayPublishCapChange?: (preview: TPrePublishRelayCapPreview) => void
  content?: string
  isPublicMessage?: boolean
  mentions?: string[]
}) {
  const { t } = useTranslation()
  /** Subtitle + trigger must match {@link selectedRelayUrls} (service description ignored: cache relays are merged in after). */
  const describeRelaySelection = useCallback(
    (urls: string[]) => {
      const n = urls.length
      if (n === 0) return t('No relays selected')
      if (n === 1) return simplifyUrl(urls[0])
      return t('{{count}} relays', { count: n })
    },
    [t]
  )
  const { isSmallScreen } = useScreenSize()
  useCurrentRelays() // Keep this hook call for any side effects
  const { relaySets, favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { pubkey, relayList, cacheRelayListEvent } = useNostr()
  const userReadRelaysForSelection = useMemo(
    () => userReadInboxUrls(relayList, cacheRelayListEvent),
    [relayList, cacheRelayListEvent]
  )
  const [selectedRelayUrls, setSelectedRelayUrls] = useState<string[]>([])
  const [selectableRelays, setSelectableRelays] = useState<string[]>([])
  const [relayTypes, setRelayTypes] = useState<Record<string, RelaySourceType>>({})
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [hasManualSelection, setHasManualSelection] = useState(false)
  const [previousSelectableCount, setPreviousSelectableCount] = useState(0)
  // Generation counter: incremented every time the effect fires; async callback checks whether
  // it's still the latest invocation before committing state, preventing stale races.
  const selectionGenRef = useRef(0)

  // For discussion replies, content doesn't affect relay selection
  // Check if this is a reply to a discussion by looking for "K" tag with "11"
  const isDiscussionReply = useMemo(() => {
    if (!_parentEvent) return false
    
    // Direct reply to discussion
    if (_parentEvent.kind === 11) return true
    
    // Check if parent event has "K" tag containing "11" (discussion root kind)
    const eventTags = _parentEvent.tags || []
    const kindTag = eventTags.find(([tagName]) => tagName === 'K')
    if (kindTag && kindTag[1] === '11') {
      return true
    }
    
    return false
  }, [_parentEvent])

  const publishCapPreview = useMemo(
    () =>
      computePrePublishRelayCapPreview({
        relayListWrite: relayList?.write,
        relayListHttpWrite: relayList?.httpWrite,
        selectedRelayUrls,
        isPublicMessage,
        parentEvent: _parentEvent,
        isDiscussionReply
      }),
    [
      relayList?.write,
      relayList?.httpWrite,
      selectedRelayUrls,
      isPublicMessage,
      _parentEvent,
      isDiscussionReply
    ]
  )

  useEffect(() => {
    onRelayPublishCapChange?.(publishCapPreview)
  }, [publishCapPreview, onRelayPublishCapChange])

  /**
   * Relay selection only cares about nostr:… mentions in the draft (see relay-selection.service).
   * Depending on full `postContent` re-ran the heavy relay effect on every keystroke.
   */
  const contentRelaySignature = useMemo(() => {
    if (isDiscussionReply) return ''
    if (isPublicMessage && mentions.length > 0) {
      // PM recipients come from `mentions` when set; content is ignored by selection service
      return ''
    }
    const matches = [...postContent.matchAll(NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX)].map((m) => m[0])
    if (!matches.length) return ''
    return [...new Set(matches)].sort().join('\n')
  }, [postContent, isDiscussionReply, isPublicMessage, mentions])

  // Memoize arrays to prevent unnecessary re-renders
  const memoizedFavoriteRelays = useMemo(() => favoriteRelays, [favoriteRelays])
  const memoizedBlockedRelays = useMemo(() => {
    // Top-level compose or reply under a social thread: also block SOCIAL_KIND_BLOCKED_RELAY_URLS in the picker.
    const isSocialPublish =
      !isPublicMessage &&
      (_parentEvent == null ||
        isDiscussionReply ||
        isSocialKindBlockedKind(_parentEvent.kind))
    return isSocialPublish
      ? [...blockedRelays, ...SOCIAL_KIND_BLOCKED_RELAY_URLS]
      : blockedRelays
  }, [blockedRelays, isPublicMessage, _parentEvent, isDiscussionReply])
  const memoizedRelaySets = useMemo(() => relaySets, [relaySets])
  const memoizedOpenFrom = useMemo(() => openFrom, [openFrom])

  // Single relay-selection effect. The generation counter (selectionGenRef) guards against
  // stale async completions: if a newer invocation has started, the older one discards its results.
  useEffect(() => {
    const gen = ++selectionGenRef.current

    const updateRelaySelection = async () => {
      setIsLoading(true)
      try {
        let userWriteRelays: string[] = []
        if (pubkey && relayList) {
          userWriteRelays = await collectViewerWriteOutboxUrls(pubkey, relayList)
        }

        const result = await relaySelectionService.selectRelays({
          userWriteRelays,
          userHttpWriteRelays: relayList?.httpWrite ?? [],
          userReadRelays: userReadRelaysForSelection,
          favoriteRelays: memoizedFavoriteRelays,
          blockedRelays: memoizedBlockedRelays,
          relaySets: memoizedRelaySets,
          parentEvent: _parentEvent,
          isPublicMessage,
          content: isDiscussionReply ? '' : postContent,
          mentions: isPublicMessage ? mentions : undefined,
          userPubkey: pubkey || undefined,
          openFrom: memoizedOpenFrom
        })

        // Discard results from a superseded invocation
        if (gen !== selectionGenRef.current) return

        const newSelectableCount = result.selectableRelays.length
        const selectableRelaysChanged = newSelectableCount !== previousSelectableCount

        setSelectableRelays(result.selectableRelays)
        setRelayTypes(result.relayTypes ?? {})
        setPreviousSelectableCount(newSelectableCount)

        if (!hasManualSelection || selectableRelaysChanged) {
          const cacheRelays = result.selectableRelays.filter(url => isLocalNetworkUrl(url))
          const selectedWithCache = Array.from(new Set([...result.selectedRelays, ...cacheRelays]))
          const capped = capAutoSelectedRelays(result.selectableRelays, selectedWithCache)
          setSelectedRelayUrls(capped)
          setDescription(describeRelaySelection(capped))
          if (selectableRelaysChanged && hasManualSelection) {
            setHasManualSelection(false)
          }
        }
      } catch (error) {
        if (gen !== selectionGenRef.current) return
        logger.error('Failed to update relay selection', { error })
        setSelectableRelays([])
        if (!hasManualSelection) {
          setSelectedRelayUrls([])
          setDescription(t('No relays selected'))
        }
      } finally {
        if (gen === selectionGenRef.current) setIsLoading(false)
      }
    }

    updateRelaySelection()
  }, [
    memoizedOpenFrom,
    _parentEvent,
    memoizedFavoriteRelays,
    memoizedBlockedRelays,
    memoizedRelaySets,
    isPublicMessage,
    pubkey,
    relayList,
    isDiscussionReply,
    contentRelaySignature,
    mentions,
    describeRelaySelection,
    t
  ])

  // Update description when selected relays change due to manual selection
  useEffect(() => {
    if (hasManualSelection && !isLoading) {
      setDescription(describeRelaySelection(selectedRelayUrls))
    }
  }, [selectedRelayUrls, hasManualSelection, isLoading, describeRelaySelection])

  // Update parent component with selected relays
  useEffect(() => {
    // An event is "protected" if we have selected relays that aren't the default user write relays
    const defaultUserWriteRelays = [...(relayList?.httpWrite ?? []), ...(relayList?.write || [])]
    const normW = (u: string) => normalizeRelayUrlByScheme(u) || u
    const defaultNorm = new Set(defaultUserWriteRelays.map(normW))
    const isProtectedEvent =
      selectedRelayUrls.length > 0 &&
      !selectedRelayUrls.every((url) => defaultNorm.has(normW(url)))
    setIsProtectedEvent(isProtectedEvent)
    setAdditionalRelayUrls(selectedRelayUrls)
  }, [selectedRelayUrls, relayList, setIsProtectedEvent, setAdditionalRelayUrls])

  const handleRelayCheckedChange = useCallback((checked: boolean, url: string) => {
    setHasManualSelection(true)
    if (checked) {
      setSelectedRelayUrls(prev => [...prev, url])
    } else {
      setSelectedRelayUrls(prev => prev.filter(u => u !== url))
    }
  }, [])

  const handleSelectAll = useCallback(() => {
    setHasManualSelection(true)
    setSelectedRelayUrls([...selectableRelays])
  }, [selectableRelays])

  const handleClearAll = useCallback(() => {
    setHasManualSelection(true)
    setSelectedRelayUrls([])
  }, [])

  const content = (
    <>
      {selectableRelays.length > 0 && (
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            title={t('Select All')}
            onClick={handleSelectAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('Select All')}
          </button>
          <button
            type="button"
            title={t('Clear All')}
            onClick={handleClearAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('Clear All')}
          </button>
        </div>
      )}
      
      {isLoading ? (
        <div className="text-sm text-muted-foreground p-2">{t('Loading relays...')}</div>
      ) : selectableRelays.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">{t('No relays available')}</div>
      ) : (
        <div className="space-y-1">
          {(() => {
            // Sort relays so selected ones appear at the top
            const sortedRelays = [...selectableRelays].sort((a, b) => {
              const aSelected = selectedRelayUrls.includes(a)
              const bSelected = selectedRelayUrls.includes(b)
              if (aSelected && !bSelected) return -1
              if (!aSelected && bSelected) return 1
              return 0
            })
            
            return sortedRelays.map((url) => {
              const isChecked = selectedRelayUrls.includes(url)
              const sourceType = relayTypes[url]
              const typeLabel = sourceType ? t(`relayType_${sourceType}`) : ''
              return (
                <div
                  key={url}
                  className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer touch-manipulation"
                  onClick={() => handleRelayCheckedChange(!isChecked, url)}
                >
                  <div className="flex items-center justify-center w-4 h-4 border border-border rounded shrink-0">
                    {isChecked && <Check className="w-3 h-3" />}
                  </div>
                  <RelayIcon url={url} className="w-4 h-4 shrink-0" />
                  <span className="text-sm flex-1 truncate min-w-0">{simplifyUrl(url)}</span>
                  {typeLabel && (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {typeLabel}
                    </span>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}
    </>
  )

  // Create compact trigger button text
  const triggerText = useMemo(() => {
    if (isLoading) return t('Loading...')
    if (selectedRelayUrls.length === 0) return t('Select relays')
    if (selectedRelayUrls.length === 1) return simplifyUrl(selectedRelayUrls[0])
    return t('{{count}} relays', { count: selectedRelayUrls.length })
  }, [selectedRelayUrls, isLoading, t])

  const capHintEl =
    publishCapPreview.showCapHint &&
    !publishCapPreview.blocksPublish &&
    (publishCapPreview.outboxSlotsInPublish > 0 ? (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        {t('Publish relay cap hint with outbox first', {
          max: MAX_PUBLISH_RELAYS,
          reservedSlots: publishCapPreview.outboxSlotsInPublish,
          selected: publishCapPreview.selectedTotal,
          selectedContacted: publishCapPreview.selectedContacted
        })}
      </span>
    ) : (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        {t('Publish relay cap hint', {
          max: MAX_PUBLISH_RELAYS,
          selected: publishCapPreview.selectedTotal,
          selectedContacted: publishCapPreview.selectedContacted
        })}
      </span>
    ))

  if (isSmallScreen) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('Post to')}</span>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              title={triggerText}
              className="h-8 px-3 text-xs justify-between min-w-0 flex-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Server className="w-3 h-3 shrink-0" />
                <span className="truncate">{triggerText}</span>
              </div>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[60vh] p-0">
            <div className="flex flex-col h-full">
              <div className="p-4 border-b flex items-center justify-between shrink-0 pr-12">
                <div className="flex flex-col min-w-0 flex-1 gap-1">
                  <span className="text-lg font-medium">{t('Select relays')}</span>
                  <span className="text-sm text-muted-foreground truncate">{description}</span>
                  {capHintEl}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden p-4">
                {content}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{t('Post to')}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title={triggerText}
            className="h-8 px-3 text-xs justify-between min-w-0 flex-1"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-3 h-3 shrink-0" />
              <span className="truncate">{triggerText}</span>
            </div>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[90vw] max-w-md p-0 max-h-[40vh] flex flex-col overflow-hidden" align="start" side="bottom" sideOffset={8}>
          <div className="p-3 border-b flex flex-col gap-1 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t('Select relays')}</span>
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            </div>
            {capHintEl}
          </div>
          <div className="max-h-[35vh] min-h-0 overflow-y-scroll overflow-x-hidden p-3">
            {content}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}