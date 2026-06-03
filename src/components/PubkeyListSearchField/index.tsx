import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function PubkeyListSearchField({
  value,
  onChange,
  className
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div className={cn('relative px-4 pb-2', className)}>
      <Search
        className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('Pubkey list search placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-8"
        aria-label={t('Pubkey list search placeholder')}
      />
    </div>
  )
}
