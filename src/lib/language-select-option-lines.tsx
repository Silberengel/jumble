import type { ReactElement } from 'react'
import { getLanguageDisplayParts } from '@/lib/language-display-meta'
import { cn } from '@/lib/utils'

type LinesProps = {
  tag: string
  /** Tighter layout for nested menus */
  compact?: boolean
  className?: string
}

/** One line: ISO/BCP47 code (mono) · English · native — for `SelectItem` / menus. */
export function LanguageSelectOptionLines({ tag, compact, className }: LinesProps): ReactElement {
  const p = getLanguageDisplayParts(tag)
  return (
    <div
      className={cn(
        'flex min-w-0 flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left',
        compact && 'max-w-[20rem]',
        className
      )}
    >
      <span
        className={cn(
          'shrink-0 font-mono tabular-nums text-muted-foreground',
          compact ? 'text-[10px]' : 'text-xs'
        )}
      >
        {p.codeLabel}
      </span>
      <span className={cn('min-w-0 font-medium leading-tight', compact ? 'text-xs' : 'text-sm')}>
        {p.englishName}
      </span>
      <span
        className={cn(
          'min-w-0 leading-tight text-muted-foreground',
          compact ? 'text-[10px]' : 'text-xs'
        )}
      >
        {p.nativeName}
      </span>
    </div>
  )
}
