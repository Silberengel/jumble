import ExploreRelayDirectory from '@/components/Explore/ExploreRelayDirectory'
import { buildExplorePopularRelayUrls } from '@/lib/explore-popular-relays'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { useSmartRelayNavigation } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TPageRef } from '@/types'
import { ArrowRight, Compass, Plus } from 'lucide-react'
import {
  forwardRef,
  FormEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toRelay } from '@/lib/link'
import { cn } from '@/lib/utils'
import {
  isKind10243HttpRelayTagUrl,
  isWebsocketUrl,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  simplifyUrl
} from '@/lib/url'

const RELAY_SUGGESTION_LIMIT = 20

/** Lower rank = better match for ordering suggestions. */
function relaySuggestionRank(normalizedUrl: string, queryLower: string): number {
  const n = normalizedUrl.toLowerCase()
  const simple = simplifyUrl(n).toLowerCase()
  if (!queryLower) return 99
  if (n === queryLower || simple === queryLower) return 0
  if (simple.startsWith(queryLower) || n.startsWith(`wss://${queryLower}`) || n.startsWith(`ws://${queryLower}`))
    return 1
  if (simple.includes(queryLower) || n.includes(queryLower)) return 2
  return 99
}

function filterMonitoringRelaySuggestions(urls: string[], rawQuery: string): string[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return []
  const matches = urls.filter((url) => relaySuggestionRank(url, q) < 99)
  matches.sort((a, b) => {
    const ra = relaySuggestionRank(a, q)
    const rb = relaySuggestionRank(b, q)
    if (ra !== rb) return ra - rb
    return simplifyUrl(a).localeCompare(simplifyUrl(b), undefined, { sensitivity: 'base' })
  })
  return matches.slice(0, RELAY_SUGGESTION_LIMIT)
}

const ExplorePage = forwardRef<TPageRef>((_, ref) => {
  const { pubkey, relayList } = useNostr()
  const layoutRef = useRef<TPageRef>(null)
  const [contentRefreshKey, setContentRefreshKey] = useState(0)
  const [listFilter, setListFilter] = useState('')

  const bumpExploreContent = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setContentRefreshKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpExploreContent
    }),
    [bumpExploreContent]
  )

  useEffect(() => {
    client.scheduleNip66RelayDiscoveryFromExplore()
  }, [])

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="explore"
      titlebar={<ExplorePageTitlebar onRefresh={bumpExploreContent} />}
      displayScrollToTopButton
    >
      <div key={contentRefreshKey} className="min-w-0 pt-2">
        <ExploreRelaySearchSection listFilter={listFilter} onListFilterChange={setListFilter} />
        <ExploreRelayDirectory listFilter={listFilter} />
      </div>
    </PrimaryPageLayout>
  )
})
ExplorePage.displayName = 'ExplorePage'
export default ExplorePage

function ExplorePageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-w-0 w-full items-center justify-between gap-2 px-2 py-1 sm:pl-3 sm:pr-2">
      <div className="flex shrink-0 items-center gap-2">
        <Compass className="size-5 shrink-0" />
        <div className="app-chrome-title">{t('Explore')}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <RefreshButton onClick={onRefresh} />
        <Button
          variant="ghost"
          size="titlebar-icon"
          className="relative w-fit shrink-0 px-3"
          onClick={() => {
            window.open(
              'https://github.com/CodyTseng/awesome-nostr-relays/issues/new?template=add-relay.md',
              '_blank'
            )
          }}
        >
          <Plus size={16} />
          {t('Submit Relay')}
        </Button>
      </div>
    </div>
  )
}

function ExploreRelaySearchSection({
  listFilter,
  onListFilterChange
}: {
  listFilter: string
  onListFilterChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [suggestOpen, setSuggestOpen] = useState(false)
  const blurCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const monitoringRelays = useMemo(() => {
    return buildExplorePopularRelayUrls({
      relayList,
      favoriteRelays,
      blockedRelays,
      max: 200
    })
  }, [relayList, favoriteRelays, blockedRelays])

  useEffect(() => {
    return () => {
      if (blurCloseTimer.current != null) clearTimeout(blurCloseTimer.current)
    }
  }, [])

  const relaySuggestions = useMemo(
    () => filterMonitoringRelaySuggestions(monitoringRelays, listFilter),
    [monitoringRelays, listFilter]
  )

  const clearBlurTimer = () => {
    if (blurCloseTimer.current != null) {
      clearTimeout(blurCloseTimer.current)
      blurCloseTimer.current = null
    }
  }

  const openRelayAndReset = (normalizedUrl: string) => {
    navigateToRelay(toRelay(normalizedUrl))
    onListFilterChange('')
    setSuggestOpen(false)
  }

  const tryOpenRelay = () => {
    const trimmed = listFilter.trim()
    if (!trimmed) return
    const normalized = normalizeAnyRelayUrl(trimmed) || normalizeHttpRelayUrl(trimmed)
    if (!normalized || (!isWebsocketUrl(normalized) && !isKind10243HttpRelayTagUrl(normalized))) {
      toast.error(t('invalid relay URL'))
      return
    }
    openRelayAndReset(normalized)
  }

  const onSubmitRelay = (e: FormEvent) => {
    e.preventDefault()
    tryOpenRelay()
  }

  return (
    <section className="min-w-0 px-2 pb-4 pt-0" aria-label={t('Search for Relays')}>
      <h2 className="mb-2 px-2 text-base font-semibold tracking-tight">{t('Search for Relays')}</h2>
      <div className="max-w-xl px-2">
        <form className="flex items-center gap-1.5" onSubmit={onSubmitRelay}>
          <div className="relative min-w-0 flex-1">
            <Input
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder={t('Relay URL…')}
              className="h-9 w-full font-mono text-sm"
              value={listFilter}
              onChange={(e) => onListFilterChange(e.target.value)}
              aria-label={t('Relay URL…')}
              aria-autocomplete="list"
              aria-expanded={suggestOpen && relaySuggestions.length > 0}
              aria-controls="explore-relay-suggestions"
              role="combobox"
              onFocus={() => {
                clearBlurTimer()
                setSuggestOpen(true)
              }}
              onBlur={() => {
                clearBlurTimer()
                blurCloseTimer.current = setTimeout(() => setSuggestOpen(false), 200)
              }}
            />
            {suggestOpen && relaySuggestions.length > 0 ? (
              <ul
                id="explore-relay-suggestions"
                role="listbox"
                className={cn(
                  'absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md'
                )}
                onMouseDown={(e) => e.preventDefault()}
              >
                {relaySuggestions.map((url) => (
                  <li key={url} role="presentation">
                    <button
                      type="button"
                      role="option"
                      className="flex w-full flex-col items-stretch gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                      onClick={() => openRelayAndReset(url)}
                    >
                      <span className="truncate font-mono">{simplifyUrl(url)}</span>
                      <span className="truncate text-xs text-muted-foreground">{url}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="icon"
            className="h-9 w-9 shrink-0"
            title={t('Open relay')}
          >
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </div>
    </section>
  )
}
