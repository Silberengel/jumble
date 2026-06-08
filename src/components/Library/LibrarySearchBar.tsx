import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { normalizeToDTag } from '@/lib/search-parser'
import type { LibraryPublicationRelaySearchAxis } from '@/lib/library-publication-index'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import modalManager from '@/services/modal-manager.service'
import { randomString } from '@/lib/random'
import { FileText, Loader2, Search, User, Wifi } from 'lucide-react'
import {
  HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  searchAxis,
  onSearchAxisChange,
  showOnlyMine,
  onShowOnlyMineChange,
  mineFilterLoading,
  onSearchRelays,
  relaySearchLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchAxis: LibraryPublicationRelaySearchAxis | null
  onSearchAxisChange: (axis: LibraryPublicationRelaySearchAxis | null) => void
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  mineFilterLoading?: boolean
  onSearchRelays?: () => void
  relaySearchLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [searching, setSearching] = useState(false)
  const [displayList, setDisplayList] = useState(false)
  const [selectableOptions, setSelectableOptions] = useState<LibrarySearchOption[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const prevSelectableCountRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const barContainerRef = useRef<HTMLDivElement>(null)
  const [suggestPanelTop, setSuggestPanelTop] = useState(0)
  const id = useMemo(() => `library-search-${randomString()}`, [])
  const canSearchRelays = searchQuery.trim().length > 0 && !relaySearchLoading

  useEffect(() => {
    const search = searchQuery.trim()
    if (!search) {
      setSelectableOptions([])
      setSelectedIndex(-1)
      setSearching(false)
      return
    }

    const normalizedDTag = normalizeToDTag(search)
    const options: LibrarySearchOption[] = [
      { axis: null, search },
      { axis: 'title', search },
      { axis: 'author', search },
      ...(normalizedDTag
        ? [{ axis: 'd-tag' as const, search: normalizedDTag, input: search }]
        : [])
    ]
    setSelectableOptions(options)
  }, [searchQuery])

  useEffect(() => {
    setDisplayList(searching && !!searchQuery.trim())
  }, [searching, searchQuery])

  useEffect(() => {
    const trimmed = searchQuery.trim()
    const len = selectableOptions.length
    if (!trimmed) {
      prevSelectableCountRef.current = 0
      return
    }
    if (len > 0 && prevSelectableCountRef.current === 0) {
      const el = searchInputRef.current
      if (el && document.activeElement !== el) {
        queueMicrotask(() => {
          el.focus({ preventScroll: true })
        })
      }
    }
    prevSelectableCountRef.current = len
  }, [searchQuery, selectableOptions])

  useEffect(() => {
    if (displayList && selectableOptions.length > 0) {
      modalManager.register(id, () => {
        setDisplayList(false)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [displayList, selectableOptions.length, id])

  const blur = () => {
    setSearching(false)
    searchInputRef.current?.blur()
  }

  const applyOption = (option: LibrarySearchOption) => {
    onSearchAxisChange(option.axis)
    if (option.input && option.input !== searchQuery) {
      onSearchQueryChange(option.input)
    }
    blur()
  }

  const updateSuggestPanelGeometry = useCallback(() => {
    const el = barContainerRef.current
    if (!el) return
    setSuggestPanelTop(el.getBoundingClientRect().bottom)
  }, [])

  useLayoutEffect(() => {
    if (!displayList || selectableOptions.length === 0 || !isSmallScreen) return
    updateSuggestPanelGeometry()
    const onScrollOrResize = () => updateSuggestPanelGeometry()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [displayList, selectableOptions.length, isSmallScreen, searchQuery, updateSuggestPanelGeometry])

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
    [selectableOptions, selectedIndex]
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
  }, [selectableOptions, selectedIndex])

  const suggestTopPx = Math.max(0, suggestPanelTop - 4)
  const suggestionsPanel = list ? (
    <div
      className={cn(
        'bg-surface-background shadow-lg',
        isSmallScreen
          ? 'fixed left-4 right-4 z-[110] overflow-y-auto rounded-b-lg border border-t-0 border-border/80 pt-1'
          : 'absolute top-full z-50 -translate-y-1 inset-x-0 rounded-b-lg pt-1'
      )}
      style={
        isSmallScreen
          ? {
              top: suggestTopPx,
              maxHeight: `calc(100dvh - ${suggestTopPx}px - 3.25rem - env(safe-area-inset-bottom, 0px))`
            }
          : undefined
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="h-fit">{list}</div>
    </div>
  ) : null

  const scopeLabel =
    searchAxis === 'title'
      ? t('Library search scope title')
      : searchAxis === 'author'
        ? t('Library search scope author')
        : searchAxis === 'd-tag'
          ? t('Library search scope dtag')
          : null

  return (
    <div className="space-y-3">
      <div ref={barContainerRef} className="relative">
        {displayList && list && !isSmallScreen && (
          <>
            {suggestionsPanel}
            <div className="fixed inset-0 z-40 w-full h-full" onClick={() => blur()} aria-hidden />
          </>
        )}
        {displayList && list && isSmallScreen && (
          <>
            <div className="fixed inset-0 z-[100] w-full h-full" onClick={() => blur()} aria-hidden />
            {suggestionsPanel}
          </>
        )}
        <SearchInput
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => {
            setSearching(true)
            onSearchQueryChange(e.target.value)
          }}
          onPaste={() => setSearching(true)}
          onKeyDown={handleKeyDown}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          placeholder={t('Library search placeholder')}
          className={cn(
            'bg-surface-background pl-3',
            displayList && isSmallScreen && 'relative z-[120]',
            displayList && !isSmallScreen && 'z-50'
          )}
          disabled={disabled}
          aria-label={t('Library search placeholder')}
        />
      </div>
      {scopeLabel ? (
        <p className="text-xs text-muted-foreground">{scopeLabel}</p>
      ) : null}
      {onSearchRelays ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={disabled || !canSearchRelays}
          onClick={onSearchRelays}
        >
          {relaySearchLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Wifi className="size-4" aria-hidden />
          )}
          {t('Library search relays')}
        </Button>
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
