import { RefreshButton } from '@/components/RefreshButton'
import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef, TSearchParams } from '@/types'
import { BookOpen, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SearchPage = forwardRef<TPageRef>((_props, ref) => {
  const { t } = useTranslation()
  const { current, display } = usePrimaryPage()
  const { pubkey, relayList } = useNostr()
  const [input, setInput] = useState('')
  const [searchParams, setSearchParams] = useState<TSearchParams | null>(null)
  const [resultRefreshKey, setResultRefreshKey] = useState(0)
  const isActive = useMemo(() => current === 'search' && display, [current, display])
  const searchBarRef = useRef<TSearchBarRef>(null)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)

  const bumpResults = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setResultRefreshKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior: ScrollBehavior = 'smooth') => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpResults
    }),
    [bumpResults]
  )

  useEffect(() => {
    if (isActive && !searchParams) {
      searchBarRef.current?.focus()
    }
  }, [isActive, searchParams])

  const onSearch = (params: TSearchParams | null) => {
    setSearchParams(params)
    if (params?.input) {
      setInput(params.input)
    }
    layoutRef.current?.scrollToTop('instant')
  }

  const clearSearch = useCallback(() => {
    setInput('')
    setSearchParams(null)
    setResultRefreshKey((k) => k + 1)
    searchBarRef.current?.blur()
    void Promise.resolve().then(() => searchBarRef.current?.focus())
  }, [])

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="search"
      titlebar={<SearchPageTitlebar onRefresh={bumpResults} />}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-4 px-4 pb-4">
        <div className="mb-4 space-y-2 relative z-40">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <SearchBar ref={searchBarRef} onSearch={onSearch} input={input} setInput={setInput} />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-9 shrink-0 px-3 text-muted-foreground hover:text-foreground"
              onClick={clearSearch}
              title={t('Search page clear description')}
              aria-label={t('Search page clear description')}
            >
              <X className="h-4 w-4 sm:mr-1.5" aria-hidden />
              <span className="hidden sm:inline">{t('Search page clear')}</span>
            </Button>
          </div>
          <Button
            variant="ghost"
            className="h-9 w-full justify-start text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-md px-3 gap-2 sm:w-auto"
            asChild
          >
            <a
              href="https://next-alexandria.gitcitadel.eu/events"
              target="_blank"
              rel="noopener noreferrer"
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              <span className="text-sm">{t('Search on Alexandria')}</span>
            </a>
          </Button>
        </div>
        <div className="h-4"></div>
        <div key={resultRefreshKey} className="min-w-0">
          <SearchResult searchParams={searchParams} />
        </div>
      </div>
    </PrimaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage

function SearchPageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
      <div className="flex items-center gap-2 pl-3">
        <Search className="size-5" />
        <div className="app-chrome-title">{t('Search page title')}</div>
      </div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}
