import { recipientHasAnyPaymentOptions } from '@/lib/merge-payment-methods'
import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import client, { replaceableEventService } from '@/services/client.service'
import { kinds, type Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import type { TPaymentInfo } from '@/types'
import type { TProfile } from '@/types'

export type RecipientPaymentData = {
  paymentInfo: TPaymentInfo | null
  profile: TProfile | null
  profileEvent: Event | null
  /** Any payto / Lightning target on kind 0 or 10133. */
  canReceiveTip: boolean
}

export function buildRecipientPaymentData(
  paymentInfo: TPaymentInfo | null,
  profile: TProfile | null,
  profileEvent: Event | null
): RecipientPaymentData {
  return {
    paymentInfo,
    profile,
    profileEvent,
    canReceiveTip: recipientHasAnyPaymentOptions(paymentInfo, profile, profileEvent)
  }
}

export function mergeRecipientPaymentData(
  partial: RecipientPaymentData | null | undefined,
  fresh: RecipientPaymentData | null | undefined
): RecipientPaymentData {
  if (!partial) {
    return fresh ?? buildRecipientPaymentData(null, null, null)
  }
  if (!fresh) return partial

  const profileEvent = fresh.profileEvent ?? partial.profileEvent
  const profile = profileEvent
    ? (fresh.profile ?? partial.profile)
    : (partial.profile ?? fresh.profile)
  const paymentInfo = pickRicherPaymentInfo(partial.paymentInfo, fresh.paymentInfo)

  return buildRecipientPaymentData(paymentInfo, profile ?? null, profileEvent)
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

export function useRecipientPaymentData(
  recipientPubkey: string | undefined,
  enabled: boolean
): RecipientPaymentData {
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
    () => buildRecipientPaymentData(paymentInfo, profile, profileEvent),
    [paymentInfo, profile, profileEvent]
  )
}
