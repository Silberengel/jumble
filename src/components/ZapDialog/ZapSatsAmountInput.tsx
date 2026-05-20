import {
  clampZapSats,
  formatSatsGrouped,
  parseGroupedIntegerInput,
  shouldHighlightLeadingSatsGroups,
  splitSatsGroupedParts
} from '@/lib/lightning'
import { cn } from '@/lib/utils'

const inputTypography =
  'text-center w-full p-0 text-6xl font-bold tabular-nums tracking-tight'

export default function ZapSatsAmountInput({
  sats,
  onSatsChange,
  id = 'sats'
}: {
  sats: number
  onSatsChange: (next: number) => void
  id?: string
}) {
  const clamped = clampZapSats(sats)
  const highlightLeading = shouldHighlightLeadingSatsGroups(clamped)
  const parts = splitSatsGroupedParts(clamped)

  return (
    <div className="relative flex justify-center w-full max-w-xs min-h-[4.5rem] items-center">
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center gap-[0.2em]',
          inputTypography
        )}
        aria-hidden
      >
        {parts.map((part, index) => (
          <span
            key={`${index}-${part}`}
            className={cn(index === 0 && highlightLeading && 'text-yellow-400')}
          >
            {part}
          </span>
        ))}
      </div>
      <input
        id={id}
        inputMode="numeric"
        value={formatSatsGrouped(clamped)}
        onChange={(e) => {
          onSatsChange(parseGroupedIntegerInput(e.target.value))
        }}
        onFocus={(e) => {
          requestAnimationFrame(() => {
            const val = e.target.value
            e.target.setSelectionRange(val.length, val.length)
          })
        }}
        className={cn(
          inputTypography,
          'relative z-10 bg-transparent text-transparent caret-foreground focus-visible:outline-none'
        )}
      />
    </div>
  )
}
