import { useUserStatus } from '@/hooks/useUserStatus'
import { userStatusLinkHref, type TUserStatus } from '@/lib/nip38-user-status'
import { userIdToPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { Activity, Music } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function StatusLine({
  status,
  icon,
  className,
  onClickStop
}: {
  status: TUserStatus
  icon: React.ReactNode
  className?: string
  onClickStop?: boolean
}) {
  const href = userStatusLinkHref(status)
  const inner = (
    <>
      <span className="shrink-0 opacity-80" aria-hidden>
        {icon}
      </span>
      <span className="truncate">{status.content}</span>
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex min-w-0 max-w-full items-center gap-1 hover:underline',
          className
        )}
        onClick={(e) => {
          if (onClickStop) e.stopPropagation()
        }}
        title={status.content}
      >
        {inner}
      </a>
    )
  }

  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)} title={status.content}>
      {inner}
    </span>
  )
}

export default function UserStatusBadge({
  userId,
  className,
  /** When true, omit loading skeleton (badge hidden until data arrives). */
  quiet = false,
  onClickStop = true
}: {
  userId: string | undefined
  className?: string
  quiet?: boolean
  onClickStop?: boolean
}) {
  const { t } = useTranslation()
  const pubkey = userId ? userIdToPubkey(userId) : ''
  const { general, music, hasStatus, isLoading } = useUserStatus(pubkey || undefined)

  if (!pubkey) return null
  if (isLoading && !hasStatus && !quiet) {
    return (
      <span
        className={cn('inline-block h-3.5 w-16 animate-pulse rounded bg-muted/80', className)}
        aria-hidden
      />
    )
  }
  if (!hasStatus) return null

  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground',
        className
      )}
      onClick={onClickStop ? (e) => e.stopPropagation() : undefined}
      onPointerDown={onClickStop ? (e) => e.stopPropagation() : undefined}
    >
      {music ? (
        <StatusLine
          status={music}
          icon={<Music className="size-3" />}
          onClickStop={onClickStop}
          className="text-muted-foreground"
        />
      ) : null}
      {general ? (
        <StatusLine
          status={general}
          icon={<Activity className="size-3" />}
          onClickStop={onClickStop}
          className="text-muted-foreground"
        />
      ) : null}
      <span className="sr-only">{t('User status')}</span>
    </span>
  )
}
