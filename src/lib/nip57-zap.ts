import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent } from '@/lib/event'
import { bech32 } from '@scure/base'
import { kinds, type Event, type NostrEvent } from 'nostr-tools'
import { utf8Encoder } from 'nostr-tools/utils'

export type ZapRequestTarget =
  | { pubkey: string; event?: undefined }
  | { pubkey: string; event: NostrEvent }

export function encodeLnurlBech32(url: string): string {
  const trimmed = url.trim()
  if (trimmed.toLowerCase().startsWith('lnurl')) return trimmed
  const words = bech32.toWords(utf8Encoder.encode(trimmed))
  return bech32.encode('lnurl', words, 1024)
}

/** Unsigned kind 9734 draft for signing via the active nostr signer. */
export function buildZapRequestDraft(opts: {
  target: ZapRequestTarget
  amountMsat: number
  lnurlBech32: string
  relays: string[]
  comment?: string
}): Event {
  const { target, amountMsat, lnurlBech32, relays, comment = '' } = opts
  const tags: string[][] = [['relays', ...relays], ['amount', String(amountMsat)], ['lnurl', lnurlBech32], ['p', target.pubkey]]

  if (target.event) {
    if (kinds.isAddressableKind(target.event.kind)) {
      tags.push(['a', getReplaceableCoordinateFromEvent(target.event)])
    } else {
      tags.push(['e', target.event.id])
    }
    tags.push(['k', String(target.event.kind)])
  }

  return {
    kind: ExtendedKind.ZAP_REQUEST,
    content: comment,
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: ''
  } as Event
}
