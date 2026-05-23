import { useFetchEvent } from '@/hooks'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { formatAmount } from '@/lib/lightning'
import { openNoteFromFetchOrCache } from '@/lib/navigation-related-events'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getSuperchatPaytoType } from '@/lib/superchat'
import {
  superchatChromePaymentChipClass,
  superchatChromePaymentIconClass,
  superchatChromeRowClass,
  superchatTitleClass
} from '@/lib/superchat-ui'
import { toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { Zap as ZapIcon } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigationOptional, useSecondaryPageOptional } from '@/PageManager'
import Username from '../Username'
import SuperchatPaymentMethodLabel from './SuperchatPaymentMethodLabel'
import SuperchatMessageArea from './SuperchatMessageArea'
import TurnIntoSuperchatButton from '../TurnIntoSuperchatButton'
import UserAvatar from '../UserAvatar'
import type { SuperchatLayoutVariant } from './Superchat'

export default function Zap({
  event,
  className,
  variant = 'thread'
}: {
  event: Event
  className?: string
  /** @deprecated Attestation button is shown automatically for payment recipients. */
  showAttestationAction?: boolean
  variant?: SuperchatLayoutVariant
}) {
  const { t } = useTranslation()
  const zapInfo = useMemo(() => getZapInfoFromEvent(event), [event])
  const zapRelayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const zapFetchOpts = useMemo(
    () => (zapRelayHints.length ? { relayHints: zapRelayHints } : undefined),
    [zapRelayHints]
  )
  const { event: targetEvent } = useFetchEvent(zapInfo?.eventId, undefined, zapFetchOpts)

  const isEventZap = Boolean(targetEvent || zapInfo?.eventId)
  const isProfileZap = Boolean(!isEventZap && zapInfo?.recipientPubkey)

  const actualRecipientPubkey = useMemo(() => {
    if (isEventZap && targetEvent) {
      return targetEvent.pubkey
    }
    if (isProfileZap) {
      return zapInfo?.recipientPubkey
    }
    return undefined
  }, [isEventZap, isProfileZap, targetEvent, zapInfo?.recipientPubkey])

  const paytoType = useMemo(() => getSuperchatPaytoType(event), [event])
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })

  const inQuietMode = targetEvent ? shouldHideInteractions(targetEvent) : false

  if (inQuietMode) {
    return null
  }

  if (!zapInfo || !zapInfo.senderPubkey) {
    return (
      <div className={cn('py-0.5 text-sm text-muted-foreground', className)}>
        [{t('Invalid zap receipt')}]
      </div>
    )
  }

  const { senderPubkey, recipientPubkey, amount, comment } = zapInfo

  const attestationRecipientPubkey = actualRecipientPubkey ?? recipientPubkey ?? null

  const { attested } = usePaymentAttestationStatus(event, attestationRecipientPubkey)

  const openZapTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (isEventZap && zapInfo?.eventId) {
      openNoteFromFetchOrCache(navigateToNote, zapInfo.eventId, targetEvent)
    } else if (isProfileZap && actualRecipientPubkey) {
      push(toProfile(actualRecipientPubkey))
    }
  }

  const isNotification = variant === 'notification'
  const isProfileWall = variant === 'profileWall'
  const showAmount = isNotification && amount != null && amount > 0
  const showAsSuperchat = isProfileWall || attested
  const hasMetaLine =
    isProfileWall ||
    (isNotification &&
      ((recipientPubkey && recipientPubkey !== senderPubkey) || isEventZap || isProfileZap))

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
              {recipientPubkey && recipientPubkey !== senderPubkey && (
                <span>
                  <span>{t('zapped')}</span>{' '}
                  <Username
                    userId={recipientPubkey}
                    className="inline font-medium text-foreground/85 hover:text-foreground"
                  />
                </span>
              )}
              {(isNotification && (isEventZap || isProfileZap)) && (
                <button
                  type="button"
                  onClick={openZapTarget}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {isEventZap
                    ? t('Zapped note')
                    : isProfileZap && actualRecipientPubkey
                      ? t('Zapped profile')
                      : t('Zap')}
                </button>
              )}
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
                className={superchatChromePaymentChipClass}
                imgClassName={superchatChromePaymentIconClass}
              />
              <span className={cn(superchatChromeRowClass, superchatTitleClass)}>{t('Superchat')}</span>
              {showAmount ? (
                <span className="text-sm font-bold tabular-nums tracking-tight text-foreground">
                  {formatAmount(amount)} {t('sats')}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <ZapIcon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="text-sm font-semibold text-foreground">{t('Zap')}</span>
              {showAmount ? (
                <span className="text-sm font-bold tabular-nums tracking-tight text-foreground">
                  {formatAmount(amount)} {t('sats')}
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      </div>
      <SuperchatMessageArea
        event={event}
        comment={comment}
        showEmptyFallback={showAsSuperchat}
      />
      {isNotification ? (
        <div className="text-sm text-muted-foreground">
          <TurnIntoSuperchatButton
            event={event}
            prominent
            attestationRecipientPubkey={attestationRecipientPubkey}
            className="mt-3"
          />
        </div>
      ) : null}
    </div>
  )
}
