import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type ComposerKindFieldsShellProps = {
  children: ReactNode
  className?: string
  /** Inner field layout; defaults to a vertical stack (`space-y-3`). */
  contentClassName?: string
  title?: ReactNode
  titleAction?: ReactNode
  intro?: ReactNode
}

/** Shared bordered panel for kind-specific composer metadata (above the main editor). */
export function ComposerKindFieldsShell({
  children,
  className,
  contentClassName,
  title,
  titleAction,
  intro
}: ComposerKindFieldsShellProps) {
  return (
    <div
      className={cn(
        'shrink-0 space-y-3 rounded-lg border border-border bg-muted/30 p-4',
        className
      )}
    >
      {title != null || titleAction != null ? (
        <div className="flex items-start justify-between gap-2">
          {title != null ? (
            typeof title === 'string' ? (
              <div className="text-sm font-medium">{title}</div>
            ) : (
              title
            )
          ) : null}
          {titleAction ?? null}
        </div>
      ) : null}
      {intro != null ? (
        typeof intro === 'string' ? (
          <p className="text-xs text-muted-foreground">{intro}</p>
        ) : (
          intro
        )
      ) : null}
      <div className={cn(contentClassName ?? 'space-y-3')}>{children}</div>
    </div>
  )
}

export type ComposerKindFieldProps = {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}

/** Label + control + optional hint, matching composer field spacing. */
export function ComposerKindField({
  label,
  htmlFor,
  hint,
  children,
  className
}: ComposerKindFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {typeof label === 'string' ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
      ) : (
        label
      )}
      {children}
      {hint != null ? (
        typeof hint === 'string' ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : (
          hint
        )
      ) : null}
    </div>
  )
}
