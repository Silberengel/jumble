import { buildPaytoUri, formatPaytoTagValue } from '@/lib/payto'
import { buildATag, buildETag } from '@/lib/draft-event'
import { isReplaceableEvent } from '@/lib/event'
import { NostrEvent } from 'nostr-tools'

export type PostPaymentContext = {
  recipientPubkey: string
  /** Payment amount in millisats. */
  amountMsat?: number
  /** payto tag value without the `payto://` prefix. */
  payto?: string
  /** Thread or wall reference for superchat placement. */
  referencedEvent?: NostrEvent
}

export function buildPostPaymentContext(params: {
  recipientPubkey: string
  amountMsat?: number
  /** Preformatted kind-9740 payto tag value. */
  payto?: string
  paytoUri?: string
  paytoType?: string
  paytoAuthority?: string
  referencedEvent?: NostrEvent
}): PostPaymentContext {
  const payto =
    params.payto ??
    (params.paytoUri != null
      ? formatPaytoTagValue(params.paytoUri)
      : params.paytoType && params.paytoAuthority
        ? formatPaytoTagValue(buildPaytoUri(params.paytoType, params.paytoAuthority))
        : undefined)

  return {
    recipientPubkey: params.recipientPubkey,
    amountMsat: params.amountMsat,
    payto,
    referencedEvent: params.referencedEvent
  }
}

export function paymentNotificationReferenceTags(
  referencedEvent?: NostrEvent
): string[][] {
  if (!referencedEvent) return []

  const tags: string[][] = []
  if (isReplaceableEvent(referencedEvent.kind)) {
    tags.push(buildATag(referencedEvent))
  } else {
    tags.push(buildETag(referencedEvent.id, referencedEvent.pubkey))
  }
  tags.push(['k', String(referencedEvent.kind)])
  return tags
}
