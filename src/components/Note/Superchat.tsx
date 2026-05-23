import { useFetchEvent } from '@/hooks'
import { openNoteFromFetchOrCache } from '@/lib/navigation-related-events'
import { parsePaytoTagType } from '@/lib/payto'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { getPaymentNotificationInfo, getSuperchatReferenceFetchId } from '@/lib/superchat'
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

export default function Superchat({
  event,
  className
}: {
  event: Event
  className?: string
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

  const { senderPubkey, recipientPubkey, comment } = info
  const hasThreadTarget = Boolean(targetEvent || referencedFetchId)
  const hasTarget = hasThreadTarget || Boolean(recipientPubkey)
  const hasMetaLine =
    (recipientPubkey && recipientPubkey !== senderPubkey) || hasTarget

  const openTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (referencedFetchId) {
      openNoteFromFetchOrCache(navigateToNote, referencedFetchId, targetEvent)
    } else if (recipientPubkey) {
      push(toProfile(recipientPubkey))
    }
  }

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      {hasMetaLine ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
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
        </div>
      ) : null}
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1',
          hasMetaLine && 'mt-1'
        )}
      >
        <SuperchatPaymentMethodLabel paytoType={paytoType} />
        <span className="text-base font-semibold text-yellow-400/90">{t('Superchat')}</span>
      </div>
      {comment ? (
        <SuperchatCommentMarkdown event={event} comment={comment} className="mt-2" />
      ) : null}
      <TurnIntoSuperchatButton event={event} prominent className="mt-3" />
    </div>
  )
}
