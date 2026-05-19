import { isNip56ReportEvent } from '@/lib/event'
import { Event } from 'nostr-tools'

export type ParsedNip56Report = {
  reportType: string | null
  reason: string | null
  reportedPubkeys: string[]
  reportedEventIds: string[]
  reportedAddresses: string[]
}

/** Extract NIP-56 report targets and human-readable reason from tags and content. */
export function parseNip56Report(event: Event): ParsedNip56Report | null {
  if (!isNip56ReportEvent(event)) return null

  const reportType =
    event.tags.find((t) => t[0] === 'report' || t[0] === 'Report')?.[1]?.trim() || null

  const reportedPubkeys: string[] = []
  const reportedEventIds: string[] = []
  const reportedAddresses: string[] = []
  const tagReasons: string[] = []

  for (const t of event.tags) {
    const key = t[0]
    const val = typeof t[1] === 'string' ? t[1].trim() : ''
    const relayOrReason = typeof t[2] === 'string' ? t[2].trim() : ''
    if (!val && !relayOrReason) continue

    if (key === 'p' || key === 'P') {
      if (val) reportedPubkeys.push(val)
      if (relayOrReason && !relayOrReason.startsWith('wss://') && !relayOrReason.startsWith('ws://')) {
        tagReasons.push(relayOrReason)
      }
    } else if (key === 'e' || key === 'E') {
      if (val) reportedEventIds.push(val)
      if (relayOrReason && !relayOrReason.startsWith('wss://') && !relayOrReason.startsWith('ws://')) {
        tagReasons.push(relayOrReason)
      }
    } else if (key === 'a' || key === 'A') {
      if (val) reportedAddresses.push(val)
      if (relayOrReason && !relayOrReason.startsWith('wss://') && !relayOrReason.startsWith('ws://')) {
        tagReasons.push(relayOrReason)
      }
    }
  }

  const content = event.content.trim()
  const reason = content || tagReasons[0] || reportType || null

  return {
    reportType,
    reason,
    reportedPubkeys,
    reportedEventIds,
    reportedAddresses
  }
}
