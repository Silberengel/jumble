import { TSearchBarRef } from '@/components/SearchBar'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { SearchPageContent } from '@/pages/search/SearchPageContent'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef, TSearchParams } from '@/types'
import { Search } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SearchPage = forwardRef<TPageRef>((_props, ref) => {
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

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="search"
      titlebar={<SearchPageTitlebar onRefresh={bumpResults} />}
      displayScrollToTopButton
    >
      <SearchPageContent
        className="min-w-0 pt-4 px-4 pb-4"
        searchParams={searchParams}
        resultRefreshKey={resultRefreshKey}
        input={input}
        setInput={setInput}
        onSearch={onSearch}
        searchBarRef={searchBarRef}
      />
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
