import { buildOrderedZapLightningAddresses } from '@/lib/merge-payment-methods'
import { formatNpub, pubkeyToNpub } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useZap } from '@/providers/ZapProvider'
import lightning from '@/services/lightning.service'
import noteStatsService from '@/services/note-stats.service'
import type { RecipientPaymentData } from '@/hooks/useRecipientAlternativePayments'
import { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatSatsGrouped } from '@/lib/lightning'

export function useNip57QuickZap(opts: {
  /** Probe LNURL-pay only while the payment dialog is open (avoids feed-wide fetch storms). */
  enabled?: boolean
  recipientPubkey: string
  referencedEvent?: NostrEvent
  recipientPayment: RecipientPaymentData
  onZapDialogClose?: () => void
}) {
  const { t } = useTranslation()
  const { pubkey, account, checkLogin } = useNostr()
  const isLoggedIn = Boolean(pubkey && account && account.signerType !== 'npub')
  const { isWalletConnected, defaultZapSats, defaultZapComment, includePublicZapReceipt } = useZap()
  const [zapping, setZapping] = useState(false)
  const enabled = opts.enabled ?? false

  const lightningAddressOptionsKey = useMemo(
    () =>
      buildOrderedZapLightningAddresses({
        profileEvent: opts.recipientPayment.profileEvent,
        profile: opts.recipientPayment.profile,
        paymentInfo: opts.recipientPayment.paymentInfo
      }).join('\u0001'),
    [
      opts.recipientPayment.profileEvent,
      opts.recipientPayment.profile,
      opts.recipientPayment.paymentInfo
    ]
  )

  const [nip57Addresses, setNip57Addresses] = useState<string[] | null>(null)

  useEffect(() => {
    if (!enabled) {
      setNip57Addresses(null)
      return
    }

    let cancelled = false

    if (!lightningAddressOptionsKey) {
      setNip57Addresses([])
      return
    }

    const candidates = lightningAddressOptionsKey.split('\u0001')
    setNip57Addresses(null)
    void lightning.filterNip57ZapEnabledAddresses(candidates).then((addrs) => {
      if (!cancelled) setNip57Addresses(addrs)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, lightningAddressOptionsKey])

  const canQuickNip57Zap =
    enabled &&
    isLoggedIn &&
    isWalletConnected &&
    defaultZapSats >= 1 &&
    nip57Addresses !== null &&
    nip57Addresses.length > 0 &&
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
    if (!canQuickNip57Zap || zapping || !nip57Addresses?.length) return
    checkLogin(async () => {
      if (!pubkey) return
      try {
        setZapping(true)
        const zapResult = await lightning.zap(
          pubkey,
          opts.referencedEvent ?? opts.recipientPubkey,
          defaultZapSats,
          defaultZapComment,
          opts.onZapDialogClose,
          undefined,
          {
            address: nip57Addresses[0],
            candidates: nip57Addresses
          }
        )
        if (!zapResult) return
        if (includePublicZapReceipt && zapResult.zapReceipt === null) {
          toast.warning(
            t(
              'Zap paid but no public receipt was published. The recipient may not use a NIP-57 zap wallet.'
            )
          )
        }
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
    nip57Addresses,
    checkLogin,
    pubkey,
    defaultZapSats,
    defaultZapComment,
    includePublicZapReceipt,
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
