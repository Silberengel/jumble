import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Search, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function LibrarySearchBar({
  searchQuery,
  onSearchQueryChange,
  showOnlyMine,
  onShowOnlyMineChange,
  onSearchRelays,
  relaySearchLoading,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  onSearchRelays?: () => void
  relaySearchLoading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const canSearchRelays = searchQuery.trim().length > 0 && !relaySearchLoading

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={t('Library search placeholder')}
          className="pl-9"
          disabled={disabled}
          aria-label={t('Library search placeholder')}
        />
      </div>
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
      </div>
    </div>
  )
}
