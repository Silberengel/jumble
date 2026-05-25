import { buildOrderedZapLightningAddresses } from '@/lib/merge-payment-methods'
import { mergePostPaymentContext, type PostPaymentContext } from '@/lib/post-payment-context'
import { buildPaytoUri } from '@/lib/payto'
import { formatNpub, pubkeyToNpub } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useZap } from '@/providers/ZapProvider'
import lightning from '@/services/lightning.service'
import noteStatsService from '@/services/note-stats.service'
import type { RecipientPaymentData } from '@/hooks/useRecipientAlternativePayments'
import { NostrEvent } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatSatsGrouped } from '@/lib/lightning'

export function useNip57QuickZap(opts: {
  recipientPubkey: string
  referencedEvent?: NostrEvent
  recipientPayment: RecipientPaymentData
  onPostPaymentRequest?: (context: PostPaymentContext) => void
  onZapDialogClose?: () => void
}) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { isWalletConnected, defaultZapSats, defaultZapComment } = useZap()
  const [zapping, setZapping] = useState(false)

  const lightningAddressOptions = useMemo(
    () =>
      buildOrderedZapLightningAddresses({
        profileEvent: opts.recipientPayment.profileEvent,
        profile: opts.recipientPayment.profile,
        paymentInfo: opts.recipientPayment.paymentInfo
      }),
    [opts.recipientPayment]
  )

  const canQuickNip57Zap =
    isWalletConnected &&
    defaultZapSats >= 1 &&
    lightningAddressOptions.length > 0 &&
    !!pubkey &&
    pubkey !== opts.recipientPubkey

  const recipientNpubLabel = useMemo(() => {
    const npub = pubkeyToNpub(opts.recipientPubkey)
    return npub ? formatNpub(npub) : opts.recipientPubkey.slice(0, 12)
  }, [opts.recipientPubkey])

  const quickZapLabel = t('Zap this npub n sats', {
    npub: recipientNpubLabel,
    n: formatSatsGrouped(defaultZapSats)
  })

  const sendQuickZap = useCallback(() => {
    if (!canQuickNip57Zap || zapping) return
    checkLogin(async () => {
      if (!pubkey) return
      try {
        setZapping(true)
        const paymentDetails = {
          amountMsat: defaultZapSats * 1000,
          paytoUri: buildPaytoUri('lightning', lightningAddressOptions[0] ?? ''),
          messageDraft: defaultZapComment.trim() || undefined
        }
        const zapResult = await lightning.zap(
          pubkey,
          opts.referencedEvent ?? opts.recipientPubkey,
          defaultZapSats,
          defaultZapComment,
          opts.onZapDialogClose,
          (result) => {
            if (!result) return
            opts.onPostPaymentRequest?.(
              mergePostPaymentContext(
                {
                  recipientPubkey: opts.recipientPubkey,
                  referencedEvent: opts.referencedEvent
                },
                paymentDetails
              )
            )
          },
          {
            address: lightningAddressOptions[0],
            candidates: lightningAddressOptions
          }
        )
        if (!zapResult) return
        if (opts.referencedEvent) {
          noteStatsService.addZap(
            pubkey,
            opts.referencedEvent.id,
            zapResult.invoice,
            defaultZapSats,
            defaultZapComment
          )
        }
      } catch (error) {
        toast.error(`${t('Zap failed')}: ${(error as Error).message}`)
      } finally {
        setZapping(false)
      }
    })
  }, [
    canQuickNip57Zap,
    zapping,
    checkLogin,
    pubkey,
    defaultZapSats,
    defaultZapComment,
    lightningAddressOptions,
    opts,
    t
  ])

  return {
    canQuickNip57Zap,
    quickZapLabel,
    sendQuickZap,
    zapping
  }
}
