import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function LibrarySearchBar({
  searchQuery,
  onSearchQueryChange,
  showOnlyMine,
  onShowOnlyMineChange,
  disabled
}: {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  showOnlyMine: boolean
  onShowOnlyMineChange: (value: boolean) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()

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
