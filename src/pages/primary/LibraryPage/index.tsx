import LibraryPublicationGrid from '@/components/Library/LibraryPublicationGrid'
import LibrarySearchBar from '@/components/Library/LibrarySearchBar'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { useLibraryPublications } from '@/hooks/useLibraryPublications'
import { LIBRARY_PAGE_SIZE } from '@/lib/library-publication-index'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { TPageRef } from '@/types'
import { BookOpen } from 'lucide-react'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const LibraryPage = forwardRef<TPageRef>((_props, ref) => {
  const { t } = useTranslation()
  const { current, display } = usePrimaryPage()
  const isActive = useMemo(() => current === 'library' && display, [current, display])
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const {
    entries,
    searchQuery,
    setSearchQuery,
    committedSearch,
    searchAxis,
    commitSearch,
    showOnlyMine,
    setShowOnlyMine,
    mineFilterLoading,
    loading,
    searchLoading,
    relaySearchLoading,
    error,
    allIndexCount,
    topLevelCount,
    refresh,
    searchOnRelays,
    hasIndexData,
    loadMoreFeed,
    defaultFeedHasMore,
    feedTotalCount
  } = useLibraryPublications(isActive)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior: ScrollBehavior = 'smooth') => layoutRef.current?.scrollToTop(behavior),
      refresh
    }),
    [refresh]
  )

  const statusLine =
    !loading && !error
      ? t('Library status line', {
          shown: entries.length,
          topLevel: topLevelCount,
          total: allIndexCount
        })
      : null

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="library"
      titlebar={<LibraryPageTitlebar onRefresh={refresh} />}
      displayScrollToTopButton
    >
      <div className="min-w-0 px-4 pb-4 pt-4">
        <div className="mb-4">
          <LibrarySearchBar
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            committedSearch={committedSearch}
            searchAxis={searchAxis}
            onCommitSearch={commitSearch}
            showOnlyMine={showOnlyMine}
            onShowOnlyMineChange={setShowOnlyMine}
            mineFilterLoading={mineFilterLoading}
            onSearchRelays={() => void searchOnRelays()}
            relaySearchLoading={relaySearchLoading}
            disabled={loading && !hasIndexData}
          />
        </div>
        {error ? (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="mb-4 text-xs text-muted-foreground">{t('Library loading')}</p>
        ) : searchLoading ? (
          <p className="mb-4 text-xs text-muted-foreground">{t('Library search loading')}</p>
        ) : mineFilterLoading ? (
          <p className="mb-4 text-xs text-muted-foreground">{t('Library mine filter loading')}</p>
        ) : relaySearchLoading ? (
          <p className="mb-4 text-xs text-muted-foreground">{t('Library relay search loading')}</p>
        ) : null}
        {statusLine ? (
          <p className="mb-4 text-xs text-muted-foreground">{statusLine}</p>
        ) : null}
        <LibraryPublicationGrid
          entries={entries}
          loading={
            (loading && entries.length === 0 && !hasIndexData) ||
            (showOnlyMine && mineFilterLoading)
          }
          emptyMessage={
            committedSearch.trim() || showOnlyMine ? t('Library empty filtered') : t('Library empty')
          }
        />
        {defaultFeedHasMore ? (
          <div className="mt-6 flex justify-center">
            <Button type="button" variant="outline" onClick={loadMoreFeed}>
              {t('Library load more', {
                count: Math.min(LIBRARY_PAGE_SIZE, feedTotalCount - entries.length)
              })}
            </Button>
          </div>
        ) : null}
      </div>
    </PrimaryPageLayout>
  )
})
LibraryPage.displayName = 'LibraryPage'
export default LibraryPage

function LibraryPageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
      <div className="flex items-center gap-2 pl-3">
        <BookOpen className="size-5" />
        <div className="app-chrome-title">{t('Library page title')}</div>
      </div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}
