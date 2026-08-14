import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { LIBRARY_RELAY_URLS } from '@/constants'
import {
  queryIndexRelaySuggest,
  type IndexRelaySuggestRow
} from '@/lib/index-relay-http'
import { normalizeToDTag } from '@/lib/search-parser'
import {
  shouldSearchPublicationContentOnRelays,
  type LibraryPublicationFilterMode,
  type LibraryStructuredSearchQuery
} from '@/lib/library-publication-index'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SUGGEST_DEBOUNCE_MS = 175
const SUGGEST_HTTP_BASES = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))

export default function LibrarySearchBar({
  searchQuery,
  onSearchQueryChange,
  onCommitSearch,
  onCommitStructuredSearch,
  onResetSearch,
  searchActive,
  searchLoading,
  filterMode,
  onFilterModeChange,
  filterLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onCommitSearch: (query: string, axis: null) => void
  onCommitStructuredSearch: (query: LibraryStructuredSearchQuery) => void
  onResetSearch: () => void
  searchActive?: boolean
  searchLoading?: boolean
  filterMode: LibraryPublicationFilterMode
  onFilterModeChange: (value: LibraryPublicationFilterMode) => void
  filterLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [advanced, setAdvanced] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [language, setLanguage] = useState('')
  const [subject, setSubject] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [dTag, setDTag] = useState('')
  const [fullText, setFullText] = useState('')
  const [suggestions, setSuggestions] = useState<IndexRelaySuggestRow[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const suggestAbortRef = useRef<AbortController | null>(null)

  // Simple (collapsed) search: the single box runs an all-fields search via the Search button or Enter.
  const runSimpleSearch = useCallback(
    (override?: string) => {
      const q = (override ?? searchQuery).trim()
      if (!q) return
      setSuggestOpen(false)
      onCommitSearch(q, null)
      searchInputRef.current?.blur()
    },
    [onCommitSearch, searchQuery]
  )

  const handleSimpleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        runSimpleSearch()
      } else if (e.key === 'Escape') {
        setSuggestOpen(false)
      }
    },
    [runSimpleSearch]
  )

  useEffect(() => {
    if (advanced || disabled) {
      setSuggestions([])
      setSuggestOpen(false)
      return
    }
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSuggestions([])
      setSuggestOpen(false)
      return
    }

    const timer = window.setTimeout(() => {
      suggestAbortRef.current?.abort()
      const abort = new AbortController()
      suggestAbortRef.current = abort
      void (async () => {
        const rows = (
          await Promise.all(
            SUGGEST_HTTP_BASES.map((base) =>
              queryIndexRelaySuggest(base, q, { limit: 8, signal: abort.signal }).catch(
                () => [] as IndexRelaySuggestRow[]
              )
            )
          )
        ).flat()
        if (abort.signal.aborted) return
        const seen = new Set<string>()
        const deduped: IndexRelaySuggestRow[] = []
        for (const row of rows) {
          const key = row.naddr || row.id || `${row.kind}:${row.d}:${row.title}`
          if (!key || seen.has(key)) continue
          seen.add(key)
          deduped.push(row)
          if (deduped.length >= 8) break
        }
        setSuggestions(deduped)
        setSuggestOpen(deduped.length > 0)
      })()
    }, SUGGEST_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      suggestAbortRef.current?.abort()
    }
  }, [advanced, disabled, searchQuery])

  const structuredQuery = useMemo<LibraryStructuredSearchQuery>(
    () => ({
      title: title.trim() || undefined,
      author: author.trim() || undefined,
      language: language.trim() || undefined,
      subject: subject.trim() || undefined,
      identifier: identifier.trim() || undefined,
      dTag: dTag.trim() ? normalizeToDTag(dTag) : undefined,
      fullText: fullText.trim() || undefined
    }),
    [author, dTag, fullText, identifier, language, subject, title]
  )

  const hasStructuredInput = !!(
    title.trim() ||
    author.trim() ||
    language.trim() ||
    subject.trim() ||
    identifier.trim() ||
    dTag.trim() ||
    fullText.trim()
  )

  const canStructuredSearch =
    !disabled &&
    !!(
      structuredQuery.title ||
      structuredQuery.author ||
      structuredQuery.language ||
      structuredQuery.subject ||
      structuredQuery.identifier ||
      structuredQuery.dTag ||
      structuredQuery.fullText
    )

  const runStructuredSearch = useCallback(() => {
    if (!canStructuredSearch) return
    onCommitStructuredSearch(structuredQuery)
  }, [canStructuredSearch, onCommitStructuredSearch, structuredQuery])

  // Thorough reset: stop any in-flight search, wipe every field (simple box + structured fields), drop
  // committed results, and collapse back to the default simple view so the panel is completely fresh.
  const resetPanel = useCallback(() => {
    setTitle('')
    setAuthor('')
    setLanguage('')
    setSubject('')
    setIdentifier('')
    setDTag('')
    setFullText('')
    setAdvanced(false)
    setSuggestions([])
    setSuggestOpen(false)
    onResetSearch()
    searchInputRef.current?.blur()
  }, [onResetSearch])

  // When opening advanced search, carry over whatever was typed in the simple box so it isn't lost.
  // A passage-like query seeds the full-text field; a short query seeds the title field.
  const toggleAdvanced = useCallback(() => {
    setAdvanced((prev) => {
      const opening = !prev
      if (opening && !hasStructuredInput) {
        const seed = searchQuery.trim()
        if (seed) {
          if (shouldSearchPublicationContentOnRelays(seed)) {
            setFullText(seed)
          } else {
            setTitle(seed)
          }
        }
      }
      if (opening) setSuggestOpen(false)
      return opening
    })
  }, [hasStructuredInput, searchQuery])

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
  // Anything worth clearing: typed text in any field, a committed/active search, or a search in flight.
  const canReset =
    !!searchLoading || hasStructuredInput || !!searchQuery.trim() || !!searchActive

  const pickSuggestion = useCallback(
    (row: IndexRelaySuggestRow) => {
      const next = (row.title || row.d || searchQuery).trim()
      if (!next) return
      onSearchQueryChange(next)
      runSimpleSearch(next)
    },
    [onSearchQueryChange, runSimpleSearch, searchQuery]
  )

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
              onFocus={() => {
                if (suggestions.length > 0) setSuggestOpen(true)
              }}
              onBlur={() => {
                window.setTimeout(() => setSuggestOpen(false), 150)
              }}
              placeholder={t('Library search placeholder')}
              className="bg-surface-background pl-3"
              disabled={disabled}
              aria-label={t('Library search placeholder')}
              aria-autocomplete="list"
              aria-expanded={suggestOpen}
            />
            {suggestOpen && suggestions.length > 0 ? (
              <ul
                className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
                role="listbox"
              >
                {suggestions.map((row, idx) => {
                  const label = row.title || row.d || row.naddr || row.id || t('Untitled')
                  const meta = [row.author, row.d].filter(Boolean).join(' · ')
                  return (
                    <li key={`${row.id || row.naddr || label}-${idx}`}>
                      <button
                        type="button"
                        role="option"
                        className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(row)}
                      >
                        <span className="line-clamp-1 font-medium text-foreground">{label}</span>
                        {meta ? (
                          <span className="line-clamp-1 text-xs text-muted-foreground">{meta}</span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
          {searchLoading ? (
            <Button
              type="button"
              variant="destructive"
              className="shrink-0 gap-1.5"
              onClick={resetPanel}
            >
              <X className="size-4" aria-hidden />
              <span>{t('Library search stop')}</span>
            </Button>
          ) : (
            // The box's own in-field clear (SearchInput) already wipes the query, which cascades to drop
            // committed results, so the simple bar doesn't need a second out-field clear button here.
            <Button
              type="button"
              className="shrink-0 gap-1.5"
              disabled={!canSimpleSearch}
              onClick={() => runSimpleSearch()}
            >
              <Search className="size-4" aria-hidden />
              <span>{t('Search')}</span>
            </Button>
          )}
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
          <StructuredField label={t('Library search field language')}>
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field language placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <StructuredField label={t('Library search field subject')}>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field subject placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <StructuredField label={t('Library search field identifier')}>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field identifier placeholder')}
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
          <StructuredField label={t('Library search field dtag')}>
            <Input
              value={dTag}
              onChange={(e) => setDTag(e.target.value)}
              onKeyDown={handleStructuredKeyDown}
              placeholder={t('Library search field dtag placeholder')}
              disabled={disabled}
            />
          </StructuredField>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={!canReset}
              onClick={resetPanel}
            >
              <X className="size-4" aria-hidden />
              <span>{t('Library search clear')}</span>
            </Button>
            {searchLoading ? (
              <Button type="button" variant="destructive" className="gap-1.5" onClick={resetPanel}>
                <X className="size-4" aria-hidden />
                <span>{t('Library search stop')}</span>
              </Button>
            ) : (
              <Button
                type="button"
                className="gap-1.5"
                disabled={!canStructuredSearch}
                onClick={runStructuredSearch}
              >
                <Search className="size-4" aria-hidden />
                <span>{t('Search')}</span>
              </Button>
            )}
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
          onClick={toggleAdvanced}
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
          <Tabs
            value={filterMode}
            onValueChange={(value) => onFilterModeChange(value as LibraryPublicationFilterMode)}
          >
            <TabsList className="h-8" aria-label={t('Library publication filter')}>
              <TabsTrigger value="mine" className="px-2.5 text-xs" disabled={disabled}>
                {t('Library filter mine')}
              </TabsTrigger>
              <TabsTrigger value="none" className="px-2.5 text-xs" disabled={disabled}>
                {t('Library filter none')}
              </TabsTrigger>
              <TabsTrigger value="recommended" className="px-2.5 text-xs" disabled={disabled}>
                {t('Library filter recommended')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {filterLoading ? (
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
