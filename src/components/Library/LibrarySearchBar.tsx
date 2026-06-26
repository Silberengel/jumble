import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { normalizeToDTag } from '@/lib/search-parser'
import type { LibraryPublicationRelaySearchAxis } from '@/lib/library-publication-index'
import { cn } from '@/lib/utils'
import { FileText, Loader2, Search, User } from 'lucide-react'
import {
  HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

type LibrarySearchOption = {
  axis: LibraryPublicationRelaySearchAxis | null
  search: string
  input?: string
}

export default function LibrarySearchBar({
  searchQuery,
  onSearchQueryChange,
  onCommitSearch,
  searchLoading,
  showOnlyMine,
  onShowOnlyMineChange,
  mineFilterLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onCommitSearch: (query: string, axis: LibraryPublicationRelaySearchAxis | null) => void
  searchLoading?: boolean
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  mineFilterLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  // The scope picked from the dropdown for the *next* search. null = all fields. Selecting a scope
  // never runs a search by itself; the search only fires from the Search button or Enter.
  const [pendingAxis, setPendingAxis] = useState<LibraryPublicationRelaySearchAxis | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectableOptions = useMemo((): LibrarySearchOption[] => {
    const search = searchQuery.trim()
    if (!search) return []

    const normalizedDTag = normalizeToDTag(search)
    return [
      { axis: null, search },
      { axis: 'title', search },
      { axis: 'author', search },
      ...(normalizedDTag
        ? [{ axis: 'd-tag' as const, search: normalizedDTag, input: search }]
        : [])
    ]
  }, [searchQuery])

  const displayList = searching && selectableOptions.length > 0

  // A fresh query resets the pending scope back to "all fields".
  useEffect(() => {
    if (!searchQuery.trim()) setPendingAxis(null)
  }, [searchQuery])

  const closeDropdown = () => {
    setSearching(false)
    setSelectedIndex(-1)
  }

  // Pick a scope for the next search. This only configures the search — it never runs it.
  const selectOption = useCallback(
    (option: LibrarySearchOption) => {
      onSearchQueryChange(option.input ?? option.search)
      setPendingAxis(option.axis)
      closeDropdown()
    },
    [onSearchQueryChange]
  )

  const runSearch = useCallback(
    (query: string, axis: LibraryPublicationRelaySearchAxis | null) => {
      if (!query.trim()) return
      setPendingAxis(axis)
      onCommitSearch(query, axis)
      closeDropdown()
      searchInputRef.current?.blur()
    },
    [onCommitSearch]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        // While navigating the dropdown, Enter just locks in the highlighted scope (no search).
        if (displayList && selectedIndex >= 0) {
          selectOption(selectableOptions[selectedIndex])
          return
        }
        runSearch(searchQuery, pendingAxis)
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (selectableOptions.length <= 0) return
        setSearching(true)
        setSelectedIndex((prev) => (prev + 1) % selectableOptions.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (selectableOptions.length <= 0) return
        setSearching(true)
        setSelectedIndex((prev) => (prev - 1 + selectableOptions.length) % selectableOptions.length)
        return
      }

      if (e.key === 'Escape') {
        closeDropdown()
      }
    },
    [displayList, pendingAxis, runSearch, searchQuery, selectOption, selectableOptions, selectedIndex]
  )

  const list = useMemo(() => {
    if (selectableOptions.length <= 0) return null
    return (
      <>
        {selectableOptions.map((option, index) => {
          if (option.axis === null) {
            return (
              <AllFieldsItem
                key="all"
                search={option.search}
                selected={selectedIndex === index}
                onClick={() => selectOption(option)}
              />
            )
          }
          if (option.axis === 'title') {
            return (
              <TitleItem
                key="title"
                search={option.search}
                selected={selectedIndex === index}
                onClick={() => selectOption(option)}
              />
            )
          }
          if (option.axis === 'author') {
            return (
              <AuthorItem
                key="author"
                search={option.search}
                selected={selectedIndex === index}
                onClick={() => selectOption(option)}
              />
            )
          }
          return (
            <DTagItem
              key="dtag"
              dtag={option.search}
              selected={selectedIndex === index}
              onClick={() => selectOption(option)}
            />
          )
        })}
      </>
    )
  }, [selectOption, selectableOptions, selectedIndex])

  const scopeLabel =
    pendingAxis === 'title'
      ? t('Library search scope title')
      : pendingAxis === 'author'
        ? t('Library search scope author')
        : pendingAxis === 'd-tag'
          ? t('Library search scope dtag')
          : null

  const canSearch = !disabled && !!searchQuery.trim()

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          {displayList && list ? (
            <div
              className="absolute top-full z-50 -translate-y-1 inset-x-0 rounded-b-lg border border-border/80 bg-surface-background pt-1 shadow-lg"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="h-fit">{list}</div>
            </div>
          ) : null}
          <SearchInput
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearching(true)
              setSelectedIndex(-1)
              onSearchQueryChange(e.target.value)
            }}
            onPaste={() => setSearching(true)}
            onKeyDown={handleKeyDown}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            placeholder={t('Library search placeholder')}
            className={cn('bg-surface-background pl-3', displayList && 'z-50')}
            disabled={disabled}
            aria-label={t('Library search placeholder')}
          />
        </div>
        <Button
          type="button"
          className="shrink-0 gap-1.5"
          disabled={!canSearch || !!searchLoading}
          onClick={() => runSearch(searchQuery, pendingAxis)}
        >
          {searchLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          <span>{t('Search')}</span>
        </Button>
      </div>
      {scopeLabel ? (
        <p className="text-xs text-muted-foreground">{scopeLabel}</p>
      ) : searchQuery.trim() ? (
        <p className="text-xs text-muted-foreground">{t('Library search commit hint')}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Switch
          id="library-show-mine"
          checked={showOnlyMine}
          onCheckedChange={onShowOnlyMineChange}
          disabled={disabled}
        />
        <Label htmlFor="library-show-mine" className="text-sm text-muted-foreground cursor-pointer">
          {t('Library show only my publications')}
        </Label>
        {mineFilterLoading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>
    </div>
  )
}

function Item({
  className,
  children,
  selected,
  ...props
}: HTMLAttributes<HTMLDivElement> & { selected?: boolean }) {
  return (
    <div
      className={cn(
        'flex gap-2 items-center px-2 py-3 hover:bg-accent rounded-md cursor-pointer',
        selected ? 'bg-accent' : '',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function AllFieldsItem({
  search,
  onClick,
  selected
}: {
  search: string
  onClick?: () => void
  selected?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <Search className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">
          {t('Library search dropdown all')}
        </span>
      </div>
      <div className="font-semibold truncate">{search}</div>
    </Item>
  )
}

function TitleItem({
  search,
  onClick,
  selected
}: {
  search: string
  onClick?: () => void
  selected?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <FileText className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">
          {t('Library search dropdown title')}
        </span>
      </div>
      <div className="font-semibold truncate">{search}</div>
    </Item>
  )
}

function AuthorItem({
  search,
  onClick,
  selected
}: {
  search: string
  onClick?: () => void
  selected?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <User className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">
          {t('Library search dropdown author')}
        </span>
      </div>
      <div className="font-semibold truncate">{search}</div>
    </Item>
  )
}

function DTagItem({
  dtag,
  onClick,
  selected
}: {
  dtag: string
  onClick?: () => void
  selected?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <FileText className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">
          {t('Library search dropdown dtag')}
        </span>
      </div>
      <div className="font-semibold truncate">{dtag}</div>
    </Item>
  )
}
