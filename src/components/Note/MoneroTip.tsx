import { useFetchEvent } from '@/hooks'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { shouldHideInteractions } from '@/lib/event-filtering'
import {
  formatXmrAmount,
  getMoneroTipInfo,
  getMoneroTipReferenceFetchId
} from '@/lib/monero-tip'
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
import { useMemo, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigationOptional, useSecondaryPageOptional } from '@/PageManager'
import Username from '../Username'
import SuperchatPaymentMethodLabel from './SuperchatPaymentMethodLabel'
import SuperchatMessageArea from './SuperchatMessageArea'
import TurnIntoSuperchatButton from '../TurnIntoSuperchatButton'
import UserAvatar from '../UserAvatar'
import type { SuperchatLayoutVariant } from './Superchat'

export default function MoneroTip({
  event,
  className,
  variant = 'thread'
}: {
  event: Event
  className?: string
  variant?: SuperchatLayoutVariant
}) {
  const { t } = useTranslation()
  const tipInfo = useMemo(() => getMoneroTipInfo(event), [event])
  const relayHints = useMemo(() => relayHintsFromEventTags(event), [event])
  const fetchOpts = useMemo(
    () => (relayHints.length ? { relayHints } : undefined),
    [relayHints]
  )
  const referencedFetchId = useMemo(
    () => (tipInfo ? getMoneroTipReferenceFetchId(tipInfo) : undefined),
    [tipInfo]
  )
  const { event: targetEvent } = useFetchEvent(referencedFetchId, undefined, fetchOpts)

  const isEventTip = Boolean(targetEvent || tipInfo?.eventId || tipInfo?.referencedCoordinate)
  const isProfileTip = Boolean(!isEventTip && tipInfo?.recipientPubkey)

  const actualRecipientPubkey = useMemo(() => {
    if (isEventTip && targetEvent) return targetEvent.pubkey
    if (isProfileTip) return tipInfo?.recipientPubkey ?? undefined
    return tipInfo?.recipientPubkey ?? undefined
  }, [isEventTip, isProfileTip, targetEvent, tipInfo?.recipientPubkey])

  const paytoType = useMemo(() => getSuperchatPaytoType(event), [event])
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })

  const inQuietMode = targetEvent ? shouldHideInteractions(targetEvent) : false
  if (inQuietMode) return null

  if (!tipInfo || !tipInfo.senderPubkey) {
    return (
      <div className={cn('py-0.5 text-sm text-muted-foreground', className)}>
        [{t('Invalid Monero tip')}]
      </div>
    )
  }

  const { senderPubkey, recipientPubkey, amountXmr, comment } = tipInfo
  const attestationRecipientPubkey = actualRecipientPubkey ?? recipientPubkey ?? null
  const { attested } = usePaymentAttestationStatus(event, attestationRecipientPubkey)

  const openTipTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (isEventTip && referencedFetchId) {
      openNoteFromFetchOrCache(navigateToNote, referencedFetchId, targetEvent)
    } else if (recipientPubkey) {
      push(toProfile(recipientPubkey))
    }
  }

  const isNotification = variant === 'notification'
  const isProfileWall = variant === 'profileWall'
  const showAmount = isNotification && amountXmr != null && amountXmr > 0
  const showAsSuperchat = isProfileWall || attested
  const hasMetaLine =
    isProfileWall ||
    (isNotification &&
      ((recipientPubkey && recipientPubkey !== senderPubkey) || isEventTip || isProfileTip))

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
                    <span>{t('tipped')}</span>{' '}
                    <Username
                      userId={recipientPubkey}
                      className="inline font-medium text-foreground/85 hover:text-foreground"
                    />
                  </span>
                )}
                {isNotification && (isEventTip || isProfileTip) && (
                  <button
                    type="button"
                    onClick={openTipTarget}
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {isEventTip
                      ? t('Monero tip note')
                      : isProfileTip
                        ? t('Monero tip profile')
                        : t('Monero tip')}
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
                    {formatXmrAmount(amountXmr)} XMR
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <SuperchatPaymentMethodLabel
                  paytoType={paytoType}
                  className={superchatChromePaymentChipClass}
                  imgClassName={superchatChromePaymentIconClass}
                />
                <span className="text-sm font-semibold text-foreground">{t('Monero tip')}</span>
                {showAmount ? (
                  <span className="text-sm font-bold tabular-nums tracking-tight text-foreground">
                    {formatXmrAmount(amountXmr)} XMR
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
        showEmptyFallback={showAsSuperchat || isNotification}
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
