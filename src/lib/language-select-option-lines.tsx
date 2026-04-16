import type { ReactElement } from 'react'
import { getLanguageDisplayParts } from '@/lib/language-display-meta'
import { cn } from '@/lib/utils'

type LinesProps = {
  tag: string
  /** Tighter layout for nested menus */
  compact?: boolean
  className?: string
}

/** Three-line block: code (mono) · English · native — for `SelectItem` / menus. */
export function LanguageSelectOptionLines({ tag, compact, className }: LinesProps): ReactElement {
  const p = getLanguageDisplayParts(tag)
  return (
    <div className={cn('flex flex-col gap-0.5 text-left', compact && 'max-w-[14rem]', className)}>
      <span
        className={cn(
          'font-mono text-muted-foreground tabular-nums',
          compact ? 'text-[10px]' : 'text-xs'
        )}
      >
        {p.codeLabel}
      </span>
      <span className={cn('font-medium leading-tight', compact ? 'text-xs' : 'text-sm')}>
        {p.englishName}
      </span>
      <span className={cn('text-muted-foreground leading-tight', compact ? 'text-[10px]' : 'text-xs')}>
        {p.nativeName}
      </span>
    </div>
  )
}
