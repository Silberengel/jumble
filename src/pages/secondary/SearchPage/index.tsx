import { RefreshButton } from '@/components/RefreshButton'
import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toSearch } from '@/lib/link'
import { parseAdvancedSearch } from '@/lib/search-parser'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { BookOpen, X } from 'lucide-react'
import { TSearchParams } from '@/types'
import { Button } from '@/components/ui/button'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SearchPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { push } = useSecondaryPage()
  const { pubkey, relayList } = useNostr()
  const [locationRevision, setLocationRevision] = useState(0)
  const [resultRefreshKey, setResultRefreshKey] = useState(0)
  const bumpResults = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setResultRefreshKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpResults)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpResults])
  const [input, setInput] = useState('')
  const searchBarRef = useRef<TSearchBarRef>(null)

  const bumpLocationRevision = useCallback(() => {
    setLocationRevision((r) => r + 1)
  }, [])

  useEffect(() => {
    const onPop = () => bumpLocationRevision()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [bumpLocationRevision])

  const searchParams = useMemo((): TSearchParams | null => {
    void locationRevision
    const params = new URLSearchParams(window.location.search)
    const type = params.get('t')
    if (
      type !== 'profile' &&
      type !== 'profiles' &&
      type !== 'notes' &&
      type !== 'hashtag' &&
      type !== 'relay'
    ) {
      return null
    }
    const search = params.get('q')
    if (!search) {
      return null
    }
    const inputFromUrl = params.get('i') ?? ''
    return { type, search, input: inputFromUrl } as TSearchParams
  }, [locationRevision])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')
    if (!q) {
      setInput('')
      return
    }
    setInput(params.get('i') ?? q)
  }, [locationRevision])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (!q) {
      void Promise.resolve().then(() => searchBarRef.current?.focus())
    }
  }, [])

  const onSearch = (params: TSearchParams | null) => {
    if (!params) {
      push(toSearch())
      bumpLocationRevision()
      setResultRefreshKey((k) => k + 1)
      return
    }
    // Check if this is a 'notes' search that contains advanced search parameters
    if (params.type === 'notes' && params.search) {
      const searchParams = parseAdvancedSearch(params.search)

      // Check if we have advanced search parameters (not just plain text)
      // Exclude unsupported multi-letter tag params (title, subject, description, author, type)
      const hasAdvancedParams = Object.keys(searchParams).some(
        (key) =>
          key !== 'dtag' &&
          key !== 'title' &&
          key !== 'subject' &&
          key !== 'description' &&
          key !== 'author' &&
          key !== 'type' &&
          searchParams[key as keyof typeof searchParams]
      )

      // Handle hashtag search - route to hashtag page
      if (searchParams.hashtag) {
        const hashtag = Array.isArray(searchParams.hashtag) ? searchParams.hashtag[0] : searchParams.hashtag
        const urlParams = new URLSearchParams()
        urlParams.set('t', hashtag)
        // Note: Kind filter only available as URL parameter k=, not from search parser
        push(`/notes?${urlParams.toString()}`)
        return
      }

      if (hasAdvancedParams || searchParams.dtag) {
        // Route to NoteListPage with advanced search
        // Note: Only include parameters that Nostr relays actually support
        // (single-letter tag indexes: #d, #t, #p, #e, #a, etc.)
        const urlParams = new URLSearchParams()
        if (searchParams.dtag) {
          urlParams.set('d', searchParams.dtag)
        }
        // Skip title, subject, description, author, type - these use multi-letter tags
        // that Nostr relays don't index
        // Note: Bare event IDs are handled as standard search, not as filter params
        // Date searches and pubkey filters removed - not supported
        // Kind filter only available as URL parameter k=, not from search parser

        push(`/notes?${urlParams.toString()}`)
        return
      }
    }

    // Default behavior - route to SearchPage
    push(toSearch(params))
    bumpLocationRevision()
  }

  const clearSearch = useCallback(() => {
    push(toSearch())
    setInput('')
    setResultRefreshKey((k) => k + 1)
    bumpLocationRevision()
    searchBarRef.current?.blur()
    void Promise.resolve().then(() => searchBarRef.current?.focus())
  }, [push, bumpLocationRevision])

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : "Search"}
      hideBackButton={hideTitlebar}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bumpResults} />}
      displayScrollToTopButton
    >
      <div className="px-4 pt-4">
        <div className="mb-4">
          <div className="text-2xl font-bold">Search Nostr</div>
        </div>
        <div className="mb-4 space-y-2 relative z-40">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <SearchBar ref={searchBarRef} input={input} setInput={setInput} onSearch={onSearch} />
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
    </SecondaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage
