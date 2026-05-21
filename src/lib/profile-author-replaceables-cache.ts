import { ExtendedKind } from '@/constants'
import { getPaymentInfoFromEvent } from '@/lib/event-metadata'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { kinds, type Event } from 'nostr-tools'

function pickNewestEvent(...candidates: (Event | undefined | null)[]): Event | undefined {
  let best: Event | undefined
  for (const e of candidates) {
    if (!e || shouldDropEventOnIngest(e)) continue
    if (!best || e.created_at >= best.created_at) best = e
  }
  return best
}

/** IndexedDB + session only — no relay round-trip (for instant profile payment UI). */
export async function loadAuthorReplaceablesFromLocalCache(pubkey: string): Promise<{
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
  profileEvent: Event | undefined
}> {
  const pk = pubkey.trim().toLowerCase()
  const [idbPayment, idbMeta] = await Promise.all([
    indexedDb.getReplaceableEvent(pk, ExtendedKind.PAYMENT_INFO).catch(() => undefined),
    indexedDb.getReplaceableEvent(pk, kinds.Metadata).catch(() => undefined)
  ])
  const sesPayment = client.eventService.listSessionEventsAuthoredBy(pk, {
    kinds: [ExtendedKind.PAYMENT_INFO],
    limit: 8
  })[0]
  const sesMeta = client.eventService.getSessionMetadataForPubkey(pk)
  const paymentEvent = pickNewestEvent(idbPayment, sesPayment)
  const profileEvent = pickNewestEvent(idbMeta, sesMeta)
  return {
    paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null,
    profileEvent
  }
}
