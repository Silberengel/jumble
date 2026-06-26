import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { normalizeToDTag } from '@/lib/search-parser'
import type { LibraryStructuredSearchQuery } from '@/lib/library-publication-index'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function LibrarySearchBar({
  searchQuery,
  onSearchQueryChange,
  onCommitSearch,
  onCommitStructuredSearch,
  searchLoading,
  showOnlyMine,
  onShowOnlyMineChange,
  mineFilterLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onCommitSearch: (query: string, axis: null) => void
  onCommitStructuredSearch: (query: LibraryStructuredSearchQuery) => void
  searchLoading?: boolean
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  mineFilterLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [advanced, setAdvanced] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [dTag, setDTag] = useState('')
  const [fullText, setFullText] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Simple (collapsed) search: the single box runs an all-fields search via the Search button or Enter.
  const runSimpleSearch = useCallback(() => {
    if (!searchQuery.trim()) return
    onCommitSearch(searchQuery, null)
    searchInputRef.current?.blur()
  }, [onCommitSearch, searchQuery])

  const handleSimpleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        runSimpleSearch()
      }
    },
    [runSimpleSearch]
  )

  const structuredQuery = useMemo<LibraryStructuredSearchQuery>(
    () => ({
      title: title.trim() || undefined,
      author: author.trim() || undefined,
      dTag: dTag.trim() ? normalizeToDTag(dTag) : undefined,
      fullText: fullText.trim() || undefined
    }),
    [author, dTag, fullText, title]
  )

  const canStructuredSearch =
    !disabled &&
    !!(structuredQuery.title || structuredQuery.author || structuredQuery.dTag || structuredQuery.fullText)

  const runStructuredSearch = useCallback(() => {
    if (!canStructuredSearch) return
    onCommitStructuredSearch(structuredQuery)
  }, [canStructuredSearch, onCommitStructuredSearch, structuredQuery])

  // Enter commits a structured search from the single-line fields (the full-text textarea allows newlines).
  const handleStructuredKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        runStructuredSearch()
      }
    },
    [runStructuredSearch]
  )

  const canSimpleSearch = !disabled && !!searchQuery.trim()

  return (
    <div className="space-y-3">
      {!advanced ? (
        <div className="flex items-stretch gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchInput
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={handleSimpleKeyDown}
              placeholder={t('Library search placeholder')}
              className="bg-surface-background pl-3"
              disabled={disabled}
              aria-label={t('Library search placeholder')}
            />
          </div>
          <Button
            type="button"
            className="shrink-0 gap-1.5"
            disabled={!canSimpleSearch || !!searchLoading}
            onClick={runSimpleSearch}
          >
            {searchLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            <span>{t('Search')}</span>
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border/80 bg-surface-background p-3">
          <StructuredField label={t('Library search field title')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field title placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <StructuredField label={t('Library search field author')}>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field author placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <StructuredField label={t('Library search field dtag')}>
            <Input
              value={dTag}
              onChange={(e) => setDTag(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field dtag placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <StructuredField label={t('Library search field fulltext')}>
            <Textarea
              value={fullText}
              onChange={(e) => setFullText(e.target.value)}
              placeholder={t('Library search field fulltext placeholder')}
              rows={3}
              disabled={disabled}
            />
          </StructuredField>
          <div className="flex justify-end">
            <Button
              type="button"
              className="gap-1.5"
              disabled={!canStructuredSearch || !!searchLoading}
              onClick={runStructuredSearch}
            >
              {searchLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Search className="size-4" aria-hidden />
              )}
              <span>{t('Search')}</span>
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground',
            disabled && 'pointer-events-none opacity-50'
          )}
          onClick={() => setAdvanced((prev) => !prev)}
          aria-expanded={advanced}
        >
          {advanced ? (
            <ChevronUp className="size-4" aria-hidden />
          ) : (
            <ChevronDown className="size-4" aria-hidden />
          )}
          <span>{t('Library search advanced')}</span>
        </button>
        <div className="flex items-center gap-2">
          <Switch
            id="library-show-mine"
            checked={showOnlyMine}
            onCheckedChange={onShowOnlyMineChange}
            disabled={disabled}
          />
          <Label
            htmlFor="library-show-mine"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            {t('Library show only my publications')}
          </Label>
          {mineFilterLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StructuredField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
