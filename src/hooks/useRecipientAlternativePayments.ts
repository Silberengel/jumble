import {
  getAlternativePaymentMethods,
  groupPaymentMethodsByDisplayType,
  mergePaymentMethods,
  recipientHasAnyPaymentOptions,
  sortMergedPaymentMethods,
  type PaymentMethodGroup
} from '@/lib/merge-payment-methods'
import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import client, { replaceableEventService } from '@/services/client.service'
import { kinds, type Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import type { TPaymentInfo } from '@/types'
import type { TProfile } from '@/types'

export type RecipientZapPaymentData = {
  paymentInfo: TPaymentInfo | null
  profile: TProfile | null
  profileEvent: Event | null
  alternativeGroups: PaymentMethodGroup[]
  /** Any payto / Lightning target on kind 0 or 10133 — used to enable zap UI. */
  canReceiveTip: boolean
}

/** Kind 10133 + profile payto targets except the Lightning address used for zapping. */
export function useRecipientZapPaymentData(
  recipientPubkey: string | undefined,
  enabled: boolean
): RecipientZapPaymentData {
  const [paymentInfo, setPaymentInfo] = useState<TPaymentInfo | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [profileEvent, setProfileEvent] = useState<Event | null>(null)

  useEffect(() => {
    if (!enabled || !recipientPubkey) {
      setPaymentInfo(null)
      setProfile(null)
      setProfileEvent(null)
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
        setProfileEvent(metaEvent ?? null)
        setProfile(metaEvent ? getProfileFromEvent(metaEvent) : null)
      } catch {
        if (!cancelled) {
          setPaymentInfo(null)
          setProfile(null)
          setProfileEvent(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recipientPubkey, enabled])

  const canReceiveTip = useMemo(
    () => recipientHasAnyPaymentOptions(paymentInfo, profile, profileEvent),
    [paymentInfo, profile, profileEvent]
  )

  const alternativeGroups = useMemo(() => {
    if (!recipientPubkey) return []
    const merged = sortMergedPaymentMethods(mergePaymentMethods(paymentInfo, profile, profileEvent))
    const alts = getAlternativePaymentMethods(merged)
    return groupPaymentMethodsByDisplayType(alts)
  }, [recipientPubkey, paymentInfo, profile, profileEvent])

  return { paymentInfo, profile, profileEvent, alternativeGroups, canReceiveTip }
}

/** @deprecated Use {@link useRecipientZapPaymentData} */
export function useRecipientAlternativePayments(
  recipientPubkey: string | undefined,
  enabled: boolean
): PaymentMethodGroup[] {
  return useRecipientZapPaymentData(recipientPubkey, enabled).alternativeGroups
}
