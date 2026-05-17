import { HIVETALK_BASE_URL } from '@/constants'

export interface HiveTalkJoinParams {
  room: string
}

/**
 * HiveTalk Honey join URL: `{base}/meet/{room}` (user enters name on the join page).
 * @see https://honey.hivetalk.org/meet/{room}
 */
export function buildHiveTalkJoinUrl(params: HiveTalkJoinParams): string {
  const base = HIVETALK_BASE_URL.replace(/\/$/, '')
  const room = params.room.trim().replace(/^\/+|\/+$/g, '')
  return `${base}/meet/${room}`
}

/** Deterministic room id for a 1:1 call between two pubkeys (same room from either side). */
export function roomIdForPubkeys(pubkeyA: string, pubkeyB: string): string {
  const [a, b] = [pubkeyA, pubkeyB].sort()
  const shortA = a.slice(0, 8)
  const shortB = b.slice(0, 8)
  return `jumble-${shortA}-${shortB}`
}

/** Room id for a scheduled call (NIP-52 calendar event); one room per event. */
export function roomIdForScheduledCall(dTag: string): string {
  return `jumble-cal-${dTag}`
}
