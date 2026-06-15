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
  committedSearch,
  searchAxis,
  onCommitSearch,
  showOnlyMine,
  onShowOnlyMineChange,
  mineFilterLoading,
  onSearchRelays,
  relaySearchLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  committedSearch: string
  searchAxis: LibraryPublicationRelaySearchAxis | null
  onCommitSearch: (query: string, axis: LibraryPublicationRelaySearchAxis | null) => void
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  mineFilterLoading?: boolean
  onSearchRelays?: () => void
  relaySearchLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const canSearchRelays = searchQuery.trim().length > 0 && !relaySearchLoading

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

  const blur = () => {
    setSearching(false)
    setSelectedIndex(-1)
    searchInputRef.current?.blur()
  }

  const applyOption = useCallback(
    (option: LibrarySearchOption) => {
      onCommitSearch(option.input ?? option.search, option.axis)
      blur()
    },
    [onCommitSearch]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        if (selectableOptions.length <= 0) return
        applyOption(selectableOptions[selectedIndex >= 0 ? selectedIndex : 0])
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (selectableOptions.length <= 0) return
        setSelectedIndex((prev) => (prev + 1) % selectableOptions.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (selectableOptions.length <= 0) return
        setSelectedIndex((prev) => (prev - 1 + selectableOptions.length) % selectableOptions.length)
        return
      }

      if (e.key === 'Escape') {
        blur()
      }
    },
    [applyOption, selectableOptions, selectedIndex]
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
                onClick={() => applyOption(option)}
              />
            )
          }
          if (option.axis === 'title') {
            return (
              <TitleItem
                key="title"
                search={option.search}
                selected={selectedIndex === index}
                onClick={() => applyOption(option)}
              />
            )
          }
          if (option.axis === 'author') {
            return (
              <AuthorItem
                key="author"
                search={option.search}
                selected={selectedIndex === index}
                onClick={() => applyOption(option)}
              />
            )
          }
          return (
            <DTagItem
              key="dtag"
              dtag={option.search}
              selected={selectedIndex === index}
              onClick={() => applyOption(option)}
            />
          )
        })}
      </>
    )
  }, [applyOption, selectableOptions, selectedIndex])

  const isCommitted = committedSearch.trim().length > 0 && committedSearch.trim() === searchQuery.trim()

  const scopeLabel =
    isCommitted && searchAxis === 'title'
      ? t('Library search scope title')
      : isCommitted && searchAxis === 'author'
        ? t('Library search scope author')
        : isCommitted && searchAxis === 'd-tag'
          ? t('Library search scope dtag')
          : null

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
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
        {onSearchRelays ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            disabled={disabled || !canSearchRelays}
            onClick={onSearchRelays}
          >
            {relaySearchLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            {t('Search')}
          </Button>
        ) : null}
      </div>
      {scopeLabel ? (
        <p className="text-xs text-muted-foreground">{scopeLabel}</p>
      ) : searchQuery.trim() && !isCommitted ? (
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
