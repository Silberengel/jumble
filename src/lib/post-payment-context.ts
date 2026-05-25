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
  /** Pre-fill kind 9740 message (e.g. LNURL-pay invoice description). */
  messageDraft?: string
  /** Thread or wall reference for superchat placement. */
  referencedEvent?: NostrEvent
}

type BuildPostPaymentContextParams = {
  recipientPubkey: string
  amountMsat?: number
  /** Preformatted kind-9740 payto tag value. */
  payto?: string
  paytoUri?: string
  paytoType?: string
  paytoAuthority?: string
  messageDraft?: string
  referencedEvent?: NostrEvent
}

export function buildPostPaymentContext(params: BuildPostPaymentContextParams): PostPaymentContext {
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
    messageDraft: params.messageDraft?.trim() || undefined,
    referencedEvent: params.referencedEvent
  }
}

/**
 * Merge payment details with a default thread reference.
 * Profile tips omit `referencedEvent` so kind 9740 defaults to the profile wall.
 */
export function mergePostPaymentContext(
  base: Pick<BuildPostPaymentContextParams, 'recipientPubkey' | 'referencedEvent'>,
  partial?: Partial<BuildPostPaymentContextParams> | null
): PostPaymentContext {
  return buildPostPaymentContext({
    ...partial,
    recipientPubkey: partial?.recipientPubkey ?? base.recipientPubkey,
    referencedEvent: partial?.referencedEvent ?? base.referencedEvent
  })
}

/** Kind 9740 thread tags: `e` or `a`, referenced kind (`k`), and author pubkey (`P` or in `e`). */
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
  tags.push(['P', referencedEvent.pubkey])
  tags.push(['k', String(referencedEvent.kind)])
  return tags
}
