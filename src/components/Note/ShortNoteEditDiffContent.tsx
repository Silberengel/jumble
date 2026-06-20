import { diffTextInline } from '@/lib/short-note-edit-diff'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'

export default function ShortNoteEditDiffContent({
  original,
  revised,
  className
}: {
  original: string
  revised: string
  className?: string
}) {
  const parts = useMemo(() => diffTextInline(original, revised), [original, revised])

  return (
    <div
      className={cn(
        'note-content text-base font-normal whitespace-pre-wrap break-words',
        'border-l-2 border-amber-500/40 pl-3 -ml-0.5',
        className
      )}
    >
      {parts.map((part, index) => {
        if (part.type === 'equal') {
          return <span key={index}>{part.value}</span>
        }
        if (part.type === 'delete') {
          return (
            <span
              key={index}
              className="line-through decoration-red-500/70 bg-red-500/10 text-muted-foreground rounded-sm"
            >
              {part.value}
            </span>
          )
        }
        return (
          <span
            key={index}
            className="bg-emerald-500/20 text-emerald-950 dark:text-emerald-100 rounded-sm"
          >
            {part.value}
          </span>
        )
      })}
    </div>
  )
}
