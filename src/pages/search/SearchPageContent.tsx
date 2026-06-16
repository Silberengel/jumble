import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import { Button } from '@/components/ui/button'
import { TSearchParams } from '@/types'
import { BookOpen } from 'lucide-react'
import { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

export function SearchPageContent({
  searchParams,
  resultRefreshKey,
  input,
  setInput,
  onSearch,
  searchBarRef,
  className
}: {
  searchParams: TSearchParams | null
  resultRefreshKey: number
  input: string
  setInput: (value: string) => void
  onSearch: (params: TSearchParams | null) => void
  searchBarRef: RefObject<TSearchBarRef>
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div className={className}>
      <div className="mb-4 space-y-2 relative z-40">
        <div className="min-w-0">
          <SearchBar ref={searchBarRef} onSearch={onSearch} input={input} setInput={setInput} />
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
      <div className="h-4" />
      <div key={resultRefreshKey} className="min-w-0">
        <SearchResult searchParams={searchParams} />
      </div>
    </div>
  )
}
