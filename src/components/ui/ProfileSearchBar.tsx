import { SEARCH_QUERY_DEBOUNCE_MS } from '@/constants'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'

interface ProfileSearchBarProps {
  onSearch: (query: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export default function ProfileSearchBar({ 
  onSearch, 
  placeholder = "Search...",
  className,
  disabled = false
}: ProfileSearchBarProps) {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  // Debounce search to avoid too many calls
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query)
    }, SEARCH_QUERY_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, onSearch])

  const handleClear = () => {
    setQuery('')
    onSearch('')
  }

  return (
    <div className={cn('relative flex items-center', className)}>
      <div className="relative flex-1">
        <Search 
          className={cn(
            'absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors',
            isFocused && 'text-green-500'
          )} 
        />
        <Input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          className={cn(
            'pl-10 pr-10 h-10',
            'border-2 border-muted-foreground/20 focus:border-green-500',
            'bg-background text-foreground',
            'transition-all duration-200',
            'rounded-lg',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
