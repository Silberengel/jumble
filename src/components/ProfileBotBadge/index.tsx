import { cn } from '@/lib/utils'

const SIZE_CLASS = {
  sm: 'h-3 w-3 min-h-[10px] min-w-[10px]',
  md: 'h-4 w-4 min-h-3 min-w-3 max-h-5 max-w-5',
  lg: 'h-7 w-7 min-h-5 min-w-5 max-h-9 max-w-9'
} as const

/**
 * Small line-art robot badge for kind-0 profiles marked with a `bot` tag
 * (see {@link profileIsBotFromKind0Tags}).
 */
export function ProfileBotBadge({
  size = 'md',
  className
}: {
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label="Bot"
      title="Bot"
      className={cn(
        'pointer-events-none absolute bottom-0 right-0 z-[25] flex items-center justify-center rounded-full bg-background/95 p-[1px] text-muted-foreground shadow-sm ring-1 ring-border',
        SIZE_CLASS[size],
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-full w-full shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 2.5v2" />
        <circle cx="12" cy="2" r="0.85" fill="currentColor" stroke="none" />
        <rect x="6" y="5" width="12" height="10" rx="2" />
        <circle cx="9.5" cy="10" r="0.95" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10" r="0.95" fill="currentColor" stroke="none" />
        <path d="M9 14.5h6" />
        <path d="M10 18v2.5M14 18v2.5" />
        <path d="M8 20.5h8" />
      </svg>
    </span>
  )
}
