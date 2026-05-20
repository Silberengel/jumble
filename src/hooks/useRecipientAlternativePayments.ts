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

export function buildRecipientZapPaymentData(
  paymentInfo: TPaymentInfo | null,
  profile: TProfile | null,
  profileEvent: Event | null
): RecipientZapPaymentData {
  const canReceiveTip = recipientHasAnyPaymentOptions(paymentInfo, profile, profileEvent)
  const merged = sortMergedPaymentMethods(mergePaymentMethods(paymentInfo, profile, profileEvent))
  const alts = getAlternativePaymentMethods(merged)
  const alternativeGroups = groupPaymentMethodsByDisplayType(alts)
  return { paymentInfo, profile, profileEvent, alternativeGroups, canReceiveTip }
}

/** Combine feed/profile snapshot with fresher relay data (dialog opens fast, then enriches). */
export function mergeRecipientZapPaymentData(
  partial: RecipientZapPaymentData | null | undefined,
  fresh: RecipientZapPaymentData | null | undefined
): RecipientZapPaymentData {
  if (!partial) {
    return fresh ?? buildRecipientZapPaymentData(null, null, null)
  }
  if (!fresh) return partial

  const profileEvent = fresh.profileEvent ?? partial.profileEvent
  const profile = profileEvent
    ? (fresh.profile ?? partial.profile)
    : (partial.profile ?? fresh.profile)
  const paymentInfo = pickRicherPaymentInfo(partial.paymentInfo, fresh.paymentInfo)

  return buildRecipientZapPaymentData(paymentInfo, profile ?? null, profileEvent)
}

function pickRicherPaymentInfo(
  a: TPaymentInfo | null | undefined,
  b: TPaymentInfo | null | undefined
): TPaymentInfo | null {
  const score = (p: TPaymentInfo | null | undefined) =>
    p?.methods?.length ?? (p?.payto ? 1 : 0)
  if (score(b) > score(a)) return b ?? null
  if (score(a) > score(b)) return a ?? null
  return b ?? a ?? null
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

  return useMemo(
    () => buildRecipientZapPaymentData(paymentInfo, profile, profileEvent),
    [paymentInfo, profile, profileEvent]
  )
}

/** @deprecated Use {@link useRecipientZapPaymentData} */
export function useRecipientAlternativePayments(
  recipientPubkey: string | undefined,
  enabled: boolean
): PaymentMethodGroup[] {
  return useRecipientZapPaymentData(recipientPubkey, enabled).alternativeGroups
}
