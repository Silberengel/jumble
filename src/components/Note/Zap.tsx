import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { formatAmount } from '@/lib/lightning'
import { openNoteFromFetchOrCache } from '@/lib/navigation-related-events'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getSuperchatPaytoType } from '@/lib/superchat'
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

export default function Zap({
  event,
  className,
  showAttestationAction = false
}: {
  event: Event
  className?: string
  showAttestationAction?: boolean
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

  const openZapTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (isEventZap && zapInfo?.eventId) {
      openNoteFromFetchOrCache(navigateToNote, zapInfo.eventId, targetEvent)
    } else if (isProfileZap && actualRecipientPubkey) {
      push(toProfile(actualRecipientPubkey))
    }
  }

  const hasMetaLine =
    (recipientPubkey && recipientPubkey !== senderPubkey) || isEventZap || isProfileZap

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      {hasMetaLine ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          {recipientPubkey && recipientPubkey !== senderPubkey && (
            <span>
              <span>{t('zapped')}</span>{' '}
              <Username
                userId={recipientPubkey}
                className="inline font-medium text-foreground/85 hover:text-foreground"
              />
            </span>
          )}
          {(isEventZap || isProfileZap) && (
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
        </div>
      ) : null}
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1',
          hasMetaLine && 'mt-1'
        )}
      >
        <SuperchatPaymentMethodLabel
          paytoType={paytoType}
          className="px-2.5 py-1.5 text-lg"
          imgClassName="size-5"
        />
        <span className="text-xl font-semibold text-yellow-400/90">{t('Superchat')}</span>
        {amount != null ? (
          <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
            {formatAmount(amount)} {t('sats')}
          </span>
        ) : null}
      </div>
      {comment ? (
        <SuperchatCommentMarkdown event={event} comment={comment} className="mt-2" />
      ) : null}
      {showAttestationAction ? (
        <TurnIntoSuperchatButton event={event} prominent className="mt-3" />
      ) : null}
    </div>
  )
}
