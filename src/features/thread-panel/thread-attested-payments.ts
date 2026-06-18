import { buildAttestedPaymentIdSet } from '@/lib/superchat'
import {
  hydrateAttestedSuperchatTargetEvents,
  mergeAttestedPaymentIdSets,
  peekAttestedSuperchatTargetEvents,
  resolveAttestedPaymentIdSet,
  resolveAttestedPaymentIdSetSync
} from '@/lib/payment-attestation-cache'
import { getPaymentAttestationTargetId } from '@/lib/superchat'
import { ExtendedKind } from '@/constants'
import client from '@/services/client.service'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { Event as NEvent } from 'nostr-tools'
import { useCallback, useEffect, useState, type MutableRefObject } from 'react'

function filterAttestedTargets(
  events: NEvent[],
  shouldIncludeRef?: MutableRefObject<((evt: NEvent) => boolean) | undefined>
): NEvent[] {
  const shouldInclude = shouldIncludeRef?.current
  if (!shouldInclude) return events
  return events.filter(shouldInclude)
}

/** Attested kind 9735/9740 ids + hydration for the thread recipient (OP). */
export function useThreadAttestedPayments(
  recipientPubkey: string | undefined,
  addReplies: (events: NEvent[]) => void,
  threadRelayUrlsRef: MutableRefObject<string[]>,
  browsingRelayUrls: string[],
  replyFetchGenRef: MutableRefObject<number>,
  /** Ref to filter — avoids re-running effects when thread reply map changes. */
  shouldIncludeAttestedTargetRef?: MutableRefObject<((evt: NEvent) => boolean) | undefined>
) {
  const [attestedPaymentIds, setAttestedPaymentIds] = useState<Set<string>>(() =>
    recipientPubkey ? resolveAttestedPaymentIdSetSync(recipientPubkey) : new Set()
  )

  const mergeAttestedPaymentIds = useCallback((incoming: ReadonlySet<string>) => {
    setAttestedPaymentIds((prev) => {
      const next = mergeAttestedPaymentIdSets(prev, incoming)
      return next.size === prev.size ? prev : next
    })
  }, [])

  const applyAttestedSuperchatWave = useCallback(
    async (
      relayAttestations: NEvent[],
      relayUrls: string[],
      fetchGeneration: number,
      foreground: boolean
    ) => {
      const pk = recipientPubkey
      if (!pk) return

      if (relayAttestations.length > 0) {
        mergeAttestedPaymentIds(buildAttestedPaymentIdSet(relayAttestations, pk))
      }

      const syncIds = resolveAttestedPaymentIdSetSync(pk)
      mergeAttestedPaymentIds(syncIds)
      const syncTargets = filterAttestedTargets(
        peekAttestedSuperchatTargetEvents(syncIds),
        shouldIncludeAttestedTargetRef
      )
      if (syncTargets.length > 0) addReplies(syncTargets)

      const attestedIds = await resolveAttestedPaymentIdSet(pk, relayAttestations)
      if (fetchGeneration !== replyFetchGenRef.current) return
      mergeAttestedPaymentIds(attestedIds)

      const targets = filterAttestedTargets(
        await hydrateAttestedSuperchatTargetEvents(attestedIds, relayUrls, {
          foreground
        }),
        shouldIncludeAttestedTargetRef
      )
      if (fetchGeneration !== replyFetchGenRef.current) return
      if (targets.length > 0) addReplies(targets)
    },
    [
      recipientPubkey,
      addReplies,
      mergeAttestedPaymentIds,
      replyFetchGenRef,
      shouldIncludeAttestedTargetRef
    ]
  )

  useEffect(() => {
    const pk = recipientPubkey
    if (!pk) return
    let cancelled = false

    const syncIds = resolveAttestedPaymentIdSetSync(pk)
    mergeAttestedPaymentIds(syncIds)
    const syncTargets = filterAttestedTargets(
      peekAttestedSuperchatTargetEvents(syncIds),
      shouldIncludeAttestedTargetRef
    )
    if (syncTargets.length > 0) addReplies(syncTargets)

    void (async () => {
      const relayHints = threadRelayUrlsRef.current.length
        ? threadRelayUrlsRef.current
        : browsingRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
      await applyAttestedSuperchatWave([], relayHints, replyFetchGenRef.current, true)
      if (cancelled) return
    })()

    return () => {
      cancelled = true
    }
  }, [
    recipientPubkey,
    addReplies,
    browsingRelayUrls,
    mergeAttestedPaymentIds,
    applyAttestedSuperchatWave,
    threadRelayUrlsRef,
    replyFetchGenRef
  ])

  useEffect(() => {
    const pk = recipientPubkey
    if (!pk) return

    const handleAttestation = (data: Event) => {
      const ce = data as CustomEvent<NEvent>
      const evt = ce.detail
      if (!evt || evt.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      if (evt.pubkey.toLowerCase() !== pk.toLowerCase()) return
      const targetId = getPaymentAttestationTargetId(evt)
      if (!targetId) return
      mergeAttestedPaymentIds(new Set([targetId]))
      const cached = client.peekSessionCachedEvent(targetId)
      if (cached) {
        const ok = filterAttestedTargets([cached], shouldIncludeAttestedTargetRef)
        if (ok.length > 0) addReplies(ok)
      }
      void client
        .fetchEvent(targetId, { relayHints: threadRelayUrlsRef.current })
        .then((target) => {
          if (!target) return
          const ok = filterAttestedTargets([target], shouldIncludeAttestedTargetRef)
          if (ok.length > 0) addReplies(ok)
        })
        .catch(() => {
          /* optional */
        })
    }
    client.addEventListener('newEvent', handleAttestation)
    return () => client.removeEventListener('newEvent', handleAttestation)
  }, [
    recipientPubkey,
    addReplies,
    mergeAttestedPaymentIds,
    threadRelayUrlsRef,
    shouldIncludeAttestedTargetRef
  ])

  return { attestedPaymentIds, mergeAttestedPaymentIds, applyAttestedSuperchatWave }
}
