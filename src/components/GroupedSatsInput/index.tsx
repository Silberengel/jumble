import { Input } from '@/components/ui/input'
import {
  clampZapSats,
  formatSatsGrouped,
  parseGroupedIntegerInput,
  SAT_GROUP_SEPARATOR,
  shouldHighlightLeadingSatsGroups,
  splitSatsGroupedParts
} from '@/lib/lightning'
import { superchatSatsLeadingHighlightClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { Fragment, type ComponentProps } from 'react'

const defaultTypography =
  'tabular-nums font-semibold text-xl sm:text-2xl md:text-2xl'

export default function GroupedSatsInput({
  sats,
  onSatsChange,
  id,
  className,
  inputClassName,
  ...inputProps
}: {
  sats: number
  onSatsChange: (next: number) => void
  id?: string
  className?: string
  inputClassName?: string
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'id' | 'className' | 'inputMode'>) {
  const clamped = clampZapSats(sats)
  const displayValue = sats === 0 ? '' : formatSatsGrouped(clamped)
  const highlightLeading = sats > 0 && shouldHighlightLeadingSatsGroups(clamped)
  const parts = sats === 0 ? [] : splitSatsGroupedParts(clamped)
  const typography = defaultTypography

  return (
    <div className={cn('relative min-w-0', className)}>
      {parts.length > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-3 right-3 z-0 flex items-center overflow-hidden"
          aria-hidden
        >
          <span className={cn('whitespace-nowrap', typography)}>
            {parts.map((part, index) => (
              <Fragment key={`${index}-${part}`}>
                {index > 0 ? SAT_GROUP_SEPARATOR : null}
                <span
                  className={cn(
                    index === 0 && highlightLeading && superchatSatsLeadingHighlightClass
                  )}
                >
                  {part}
                </span>
              </Fragment>
            ))}
          </span>
        </div>
      ) : null}
      <Input
        id={id}
        inputMode="numeric"
        value={displayValue}
        onChange={(e) => onSatsChange(parseGroupedIntegerInput(e.target.value))}
        onFocus={(e) => {
          requestAnimationFrame(() => {
            const val = e.target.value
            e.target.setSelectionRange(val.length, val.length)
          })
        }}
        className={cn(
          'relative z-10 bg-transparent text-transparent caret-foreground',
          'selection:bg-primary/20 selection:text-transparent',
          typography,
          inputClassName
        )}
        {...inputProps}
      />
    </div>
  )
}
