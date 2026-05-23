import { ExtendedKind } from '@/constants'
import { generateBech32IdFromATag, generateBech32IdFromETag } from '@/lib/tag'
import { Event } from 'nostr-tools'

export type MoneroTipInfo = {
  senderPubkey: string
  recipientPubkey: string | null
  eventId?: string
  referencedCoordinate?: string
  /** Parsed XMR amount when present (9736 `amount` tag). */
  amountXmr?: number
  comment?: string
  txid?: string
  verified?: boolean
}

function firstTagValue(tags: string[][], names: readonly string[]): string | undefined {
  for (const tag of tags) {
    const name = tag[0]
    const value = tag[1]?.trim()
    if (value && names.includes(name)) return value
  }
  return undefined
}

function allTagValues(tags: string[][], name: string): string[] {
  const out: string[] = []
  for (const tag of tags) {
    if (tag[0] === name && tag[1]?.trim()) out.push(tag[1].trim())
  }
  return out
}

function parseAmountXmr(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

type GarnetTipProof = {
  txid?: string
  txId?: string
  message?: string | null
}

function parseGarnetTipProof(content: string): GarnetTipProof | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as GarnetTipProof
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function isMoneroTipKind(kind: number): boolean {
  return kind === ExtendedKind.MONERO_TIP_DISCLOSURE || kind === ExtendedKind.MONERO_TIP_RECEIPT
}

export function getMoneroTipInfo(event: Event): MoneroTipInfo | null {
  if (event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE) {
    const recipientPubkey = firstTagValue(event.tags, ['p']) ?? null
    const senderPubkey =
      firstTagValue(event.tags, ['P'])?.toLowerCase() ?? event.pubkey.toLowerCase()
    const amountTag = firstTagValue(event.tags, ['amount'])
    const amountXmr = parseAmountXmr(amountTag)
    const verifiedTag = firstTagValue(event.tags, ['verified'])
    const verified = verifiedTag?.toLowerCase() === 'true'
    const eTag = event.tags.find((t) => t[0] === 'e' || t[0] === 'E')
    const originalEventId = eTag?.[1]
    const eventId = eTag ? generateBech32IdFromETag(eTag) ?? originalEventId : undefined
    const aTag = event.tags.find((t) => t[0] === 'a' || t[0] === 'A')
    const referencedCoordinate = aTag?.[1]
    const comment = event.content?.trim() || undefined
    return {
      senderPubkey,
      recipientPubkey,
      eventId,
      referencedCoordinate,
      amountXmr,
      comment,
      txid: firstTagValue(event.tags, ['txid']),
      verified
    }
  }

  if (event.kind === ExtendedKind.MONERO_TIP_RECEIPT) {
    const proof = parseGarnetTipProof(event.content)
    const recipientPubkeys = allTagValues(event.tags, 'p')
    const recipientPubkey = recipientPubkeys[0] ?? null
    const eTag = event.tags.find((t) => t[0] === 'e' || t[0] === 'E')
    const originalEventId = eTag?.[1]
    const eventId = eTag ? generateBech32IdFromETag(eTag) ?? originalEventId : undefined
    const aTag = event.tags.find((t) => t[0] === 'a' || t[0] === 'A')
    const referencedCoordinate = aTag?.[1]
    const message = proof?.message?.trim()
    return {
      senderPubkey: event.pubkey.toLowerCase(),
      recipientPubkey,
      eventId,
      referencedCoordinate,
      comment: message || undefined,
      txid: proof?.txid ?? proof?.txId
    }
  }

  return null
}

/** Sort key for superchat ordering (higher = larger tip). */
export function getMoneroTipSortAmount(event: Event): number {
  const info = getMoneroTipInfo(event)
  if (!info?.amountXmr) return 0
  return Math.round(info.amountXmr * 1e8)
}

export function formatXmrAmount(amountXmr: number): string {
  if (!Number.isFinite(amountXmr) || amountXmr <= 0) return '0'
  if (amountXmr >= 1) {
    return amountXmr.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  return amountXmr.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function getMoneroTipReferenceFetchId(info: MoneroTipInfo): string | undefined {
  if (info.eventId) return info.eventId
  if (info.referencedCoordinate) {
    return generateBech32IdFromATag(['a', info.referencedCoordinate]) ?? undefined
  }
  return undefined
}
