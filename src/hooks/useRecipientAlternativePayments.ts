import {
  getAlternativePaymentMethods,
  groupPaymentMethodsByDisplayType,
  mergePaymentMethods,
  sortMergedPaymentMethods,
  type PaymentMethodGroup
} from '@/lib/merge-payment-methods'
import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import client, { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import type { TPaymentInfo } from '@/types'
import type { TProfile } from '@/types'

/** Kind 10133 + profile payto targets except the Lightning address used for zapping. */
export function useRecipientAlternativePayments(
  recipientPubkey: string | undefined,
  enabled: boolean
): PaymentMethodGroup[] {
  const [paymentInfo, setPaymentInfo] = useState<TPaymentInfo | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)

  useEffect(() => {
    if (!enabled || !recipientPubkey) {
      setPaymentInfo(null)
      setProfile(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [paymentEvent, metaEvent] = await Promise.all([
          client.fetchPaymentInfoEvent(recipientPubkey),
          replaceableEventService.fetchReplaceableEvent(recipientPubkey, kinds.Metadata)
        ])
        if (cancelled) return
        setPaymentInfo(paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null)
        setProfile(metaEvent ? getProfileFromEvent(metaEvent) : null)
      } catch {
        if (!cancelled) {
          setPaymentInfo(null)
          setProfile(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recipientPubkey, enabled])

  return useMemo(() => {
    if (!recipientPubkey) return []
    const merged = sortMergedPaymentMethods(mergePaymentMethods(paymentInfo, profile))
    const alts = getAlternativePaymentMethods(merged, profile?.lightningAddress)
    return groupPaymentMethodsByDisplayType(alts)
  }, [recipientPubkey, paymentInfo, profile])
}
