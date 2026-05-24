import { ExtendedKind } from '@/constants'
import {
  collectPaymentAttestationsFromSession,
  mergeAttestedPaymentIdSets
} from '@/lib/payment-attestation-cache'
import { buildGlobalAttestedSuperchatIdSet } from '@/lib/superchat'
import client from '@/services/client.service'
import type { Event as NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

function idsFromAttestations(attestations: NostrEvent[]): Set<string> {
  return buildGlobalAttestedSuperchatIdSet(attestations)
}

/** Attested superchat target ids (9735 / 9740 / 9736 / 1814) for feed filtering. */
export function useFeedAttestedSuperchatIds(relayUrls: string[]): Set<string> {
  const [attestedIds, setAttestedIds] = useState<Set<string>>(() =>
    idsFromAttestations(collectPaymentAttestationsFromSession())
  )

  const mergeAttestations = useCallback((incoming: NostrEvent[]) => {
    if (incoming.length === 0) return
    const next = idsFromAttestations(incoming)
    setAttestedIds((prev) => {
      const merged = mergeAttestedPaymentIdSets(prev, next)
      return merged.size === prev.size ? prev : merged
    })
  }, [])

  const relayUrlsKey = useMemo(
    () =>
      [...relayUrls]
        .map((u) => u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [relayUrls]
  )

  useEffect(() => {
    mergeAttestations(collectPaymentAttestationsFromSession())
  }, [mergeAttestations])

  useEffect(() => {
    const handleNewEvent = (data: Event) => {
      const evt = (data as CustomEvent<NostrEvent>).detail
      if (!evt || evt.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      mergeAttestations([evt])
    }
    client.addEventListener('newEvent', handleNewEvent)
    return () => client.removeEventListener('newEvent', handleNewEvent)
  }, [mergeAttestations])

  useEffect(() => {
    if (!relayUrlsKey) return
    const urls = relayUrlsKey.split('|').filter(Boolean)
    if (urls.length === 0) return
    let cancelled = false
    void client
      .fetchEvents(urls, { kinds: [ExtendedKind.PAYMENT_ATTESTATION], limit: 500 }, { cache: true })
      .then((events) => {
        if (!cancelled) mergeAttestations(events)
      })
      .catch(() => {
        /* optional */
      })
    return () => {
      cancelled = true
    }
  }, [relayUrlsKey, mergeAttestations])

  return attestedIds
}
