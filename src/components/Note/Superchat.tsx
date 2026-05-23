import { useFetchEvent } from '@/hooks'
import { parsePaytoTagType } from '@/lib/payto'
import { getPaymentNotificationInfo, getSuperchatReferenceFetchId } from '@/lib/superchat'
import { toNote, toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigationOptional, useSecondaryPageOptional } from '@/PageManager'
import Username from '../Username'
import UserAvatar from '../UserAvatar'
import SuperchatPaymentMethodLabel from './SuperchatPaymentMethodLabel'

export default function Superchat({
  event,
  className,
  omitSenderHeading,
  variant = 'default'
}: {
  event: Event
  className?: string
  omitSenderHeading?: boolean
  variant?: 'default' | 'compact'
}) {
  const { t } = useTranslation()
  const info = useMemo(() => getPaymentNotificationInfo(event), [event])
  const paytoType = useMemo(
    () => (info?.payto ? parsePaytoTagType(info.payto) : 'unknown'),
    [info?.payto]
  )
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })

  const referencedFetchId = useMemo(
    () => (info ? getSuperchatReferenceFetchId(info) : undefined),
    [info]
  )

  const { event: targetEvent } = useFetchEvent(referencedFetchId)

  if (!info) {
    return (
      <div
        className={cn(
          'text-sm text-muted-foreground',
          variant === 'compact' ? 'py-0.5' : 'rounded-lg border border-border bg-muted/20 p-4',
          className
        )}
      >
        [{t('Invalid superchat')}]
      </div>
    )
  }

  const { senderPubkey, recipientPubkey, comment } = info
  const hasThreadTarget = Boolean(targetEvent || referencedFetchId)
  const hasTarget = hasThreadTarget || Boolean(recipientPubkey)

  const openTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (targetEvent) {
      navigateToNote(toNote(targetEvent), targetEvent)
    } else if (referencedFetchId) {
      navigateToNote(toNote(referencedFetchId))
    } else if (recipientPubkey) {
      push(toProfile(recipientPubkey))
    }
  }

  if (variant === 'compact') {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <SuperchatPaymentMethodLabel paytoType={paytoType} />
          <span className="text-xs font-medium text-yellow-400/90">{t('Superchat')}</span>
          {recipientPubkey && recipientPubkey !== senderPubkey ? (
            <span className="text-xs">
              <span>{t('to')}</span>{' '}
              <Username
                userId={recipientPubkey}
                className="inline font-medium text-foreground/85 hover:text-foreground"
              />
            </span>
          ) : null}
          {hasTarget ? (
            <button
              type="button"
              onClick={openTarget}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {hasThreadTarget ? t('Superchat thread') : t('Superchat profile')}
            </button>
          ) : null}
        </div>
        {comment ? (
          <p className="mt-1.5 text-sm leading-snug text-foreground/90 whitespace-pre-wrap break-words">
            {comment}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border border-yellow-400/35 bg-yellow-400/5 p-4 text-card-foreground shadow-sm',
        className
      )}
    >
      {hasTarget ? (
        <button
          type="button"
          onClick={openTarget}
          className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border bg-secondary/80 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary"
        >
          {hasThreadTarget ? t('View thread') : t('View profile')}
        </button>
      ) : null}

      <div className="flex items-start gap-3 pb-10 pr-2 sm:pr-36">
        <div className="mt-1 shrink-0">
          <SuperchatPaymentMethodLabel paytoType={paytoType} className="text-sm" />
        </div>
        <div className="min-w-0 flex-1">
          {!omitSenderHeading && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <UserAvatar userId={senderPubkey} size="small" />
              <Username userId={senderPubkey} className="font-semibold text-foreground" />
              <span className="text-sm font-medium text-yellow-400/90">{t('Superchat')}</span>
              {recipientPubkey && recipientPubkey !== senderPubkey && (
                <>
                  <span className="text-sm text-muted-foreground">{t('to')}</span>
                  <UserAvatar userId={recipientPubkey} size="small" />
                  <Username userId={recipientPubkey} className="font-semibold text-foreground" />
                </>
              )}
            </div>
          )}

          {comment ? (
            <div className="rounded-r-md border-l-[3px] border-yellow-400 bg-muted/40 py-2.5 pl-3 pr-2 dark:bg-muted/25">
              <p className="text-lg font-semibold leading-snug tracking-tight text-foreground whitespace-pre-wrap break-words">
                {comment}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
