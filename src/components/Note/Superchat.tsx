import { useFetchEvent } from '@/hooks'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { openNoteFromFetchOrCache } from '@/lib/navigation-related-events'
import { formatAmount } from '@/lib/lightning'
import { parsePaytoTagType } from '@/lib/payto'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getPaymentNotificationInfo, getSuperchatReferenceFetchId } from '@/lib/superchat'
import { superchatTitleClass } from '@/lib/superchat-ui'
import { toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigationOptional, useSecondaryPageOptional } from '@/PageManager'
import Username from '../Username'
import SuperchatPaymentMethodLabel from './SuperchatPaymentMethodLabel'
import SuperchatCommentMarkdown from './SuperchatCommentMarkdown'
import TurnIntoSuperchatButton from '../TurnIntoSuperchatButton'
import UserAvatar from '../UserAvatar'

export type SuperchatLayoutVariant = 'notification' | 'profileWall' | 'thread'

export default function Superchat({
  event,
  className,
  variant = 'thread'
}: {
  event: Event
  className?: string
  /** @deprecated Attestation button is shown automatically for payment recipients. */
  showAttestationAction?: boolean
  /** `notification`: recipient + view links; `profileWall`: sender row; `thread`: body only. */
  variant?: SuperchatLayoutVariant
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

  const threadRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const threadFetchOpts = useMemo(
    () => (threadRelayHints.length ? { relayHints: threadRelayHints } : undefined),
    [threadRelayHints]
  )
  const { event: targetEvent } = useFetchEvent(referencedFetchId, undefined, threadFetchOpts)

  if (!info) {
    return (
      <div className={cn('py-0.5 text-sm text-muted-foreground', className)}>
        [{t('Invalid superchat')}]
      </div>
    )
  }

  const { senderPubkey, recipientPubkey, comment, amountSats } = info
  const { attested } = usePaymentAttestationStatus(event, recipientPubkey)
  const hasThreadTarget = Boolean(targetEvent || referencedFetchId)
  const isNotification = variant === 'notification'
  const isProfileWall = variant === 'profileWall'
  const showAmount = isNotification && amountSats > 0
  const showAsSuperchat = isProfileWall || attested
  const hasTarget = isNotification && (hasThreadTarget || Boolean(recipientPubkey))
  const hasMetaLine =
    isProfileWall ||
    (isNotification && ((recipientPubkey && recipientPubkey !== senderPubkey) || hasTarget))

  const openTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (referencedFetchId) {
      openNoteFromFetchOrCache(navigateToNote, referencedFetchId, targetEvent)
    } else if (recipientPubkey) {
      push(toProfile(recipientPubkey))
    }
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-sm text-muted-foreground">
      {hasMetaLine ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          {isProfileWall ? (
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar userId={senderPubkey} size="small" className="shrink-0" />
              <Username
                userId={senderPubkey}
                showAt
                className="min-w-0 font-medium text-foreground/85 hover:text-foreground"
              />
              <SuperchatPaymentMethodLabel
                paytoType={paytoType}
                className="shrink-0"
                imgClassName="size-5"
              />
            </div>
          ) : (
            <>
              {recipientPubkey && recipientPubkey !== senderPubkey ? (
                <span>
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
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {hasThreadTarget ? t('Superchat thread') : t('Superchat profile')}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {!isProfileWall ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1',
            hasMetaLine && 'mt-1'
          )}
        >
          {showAsSuperchat ? (
            <>
              <SuperchatPaymentMethodLabel
                paytoType={paytoType}
                className="px-2.5 py-1.5 text-lg"
                imgClassName="size-5"
              />
              <span className={cn('text-xl', superchatTitleClass)}>{t('Superchat')}</span>
              {showAmount ? (
                <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
                  {formatAmount(amountSats)} {t('sats')}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <SuperchatPaymentMethodLabel
                paytoType={paytoType}
                className="px-2.5 py-1.5 text-lg"
                imgClassName="size-5"
              />
              {showAmount ? (
                <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">
                  {formatAmount(amountSats)} {t('sats')}
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      </div>
      {comment ? (
        <SuperchatCommentMarkdown event={event} comment={comment} className="mt-2" />
      ) : null}
      {isNotification ? (
        <div className="text-sm text-muted-foreground">
          <TurnIntoSuperchatButton
            event={event}
            prominent
            attestationRecipientPubkey={recipientPubkey}
            className="mt-3"
          />
        </div>
      ) : null}
    </div>
  )
}
