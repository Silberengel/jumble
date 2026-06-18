import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useVisualViewportInset } from '@/hooks/useVisualViewportInset'
import { cn } from '@/lib/utils'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export type ComposerShellProps = {
  titlebar?: ReactNode
  context?: ReactNode
  blockBanner?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** When true, pin footer to visual viewport (mobile page mode). */
  pinFooterToViewport?: boolean
}

export function ComposerShell({
  titlebar,
  context,
  blockBanner,
  children,
  footer,
  className,
  pinFooterToViewport = false
}: ComposerShellProps) {
  const { bottomInset } = useVisualViewportInset()

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
        pinFooterToViewport && 'relative',
        className
      )}
    >
      {titlebar}
      {context}
      {blockBanner}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      {footer ? (
        <div
          className={cn(
            'shrink-0 border-t border-border bg-background',
            pinFooterToViewport && 'fixed left-0 right-0 z-[52]'
          )}
          style={
            pinFooterToViewport
              ? {
                  bottom: bottomInset,
                  paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))'
                }
              : undefined
          }
        >
          {footer}
        </div>
      ) : null}
      {pinFooterToViewport && footer ? (
        <div className="shrink-0" aria-hidden style={{ height: 'var(--composer-footer-spacer, 7rem)' }} />
      ) : null}
    </div>
  )
}

export type ComposerTitlebarProps = {
  title: ReactNode
  onBack?: () => void
  backDisabled?: boolean
  publishLabel: string
  onPublish?: () => void
  publishDisabled?: boolean
  publishing?: boolean
  optionsSlot?: ReactNode
}

export function ComposerTitlebar({
  title,
  onBack,
  backDisabled,
  publishLabel,
  onPublish,
  publishDisabled,
  publishing,
  optionsSlot
}: ComposerTitlebarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 min-h-11">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          title="Back"
          disabled={backDisabled}
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1 truncate text-base font-semibold">{title}</div>
      {optionsSlot}
      {onPublish ? (
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={publishDisabled}
          onClick={onPublish}
        >
          {publishing ? (
            <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />
          ) : null}
          {publishLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function ComposerBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain popover-scroll-y px-4 py-3',
        className
      )}
    >
      {children}
    </div>
  )
}

export function ComposerContextRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('shrink-0 border-b border-border px-4 py-2 space-y-2', className)}>{children}</div>
  )
}

export function ComposerBlockBanner({
  message,
  actionLabel,
  onAction
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">{message}</span>
        {actionLabel && onAction ? (
          <Button type="button" variant="outline" size="sm" className="shrink-0 h-8" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function ComposerFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-3 pt-2 pb-1', className)}>{children}</div>
}
