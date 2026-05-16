import { HIVETALK_BASE_URL } from '@/constants'

export interface HiveTalkJoinParams {
  room: string
  name: string
  roomPassword?: string
  audio?: boolean
  video?: boolean
  screen?: boolean
  notify?: boolean
  hide?: boolean
  token?: string
}

/**
 * Build a HiveTalk Honey direct-join URL (`/meet/{room}&name=…&…`).
 * Legacy vanilla used `/join?room=…` — see https://honey.hivetalk.org
 */
export function buildHiveTalkJoinUrl(params: HiveTalkJoinParams): string {
  const base = HIVETALK_BASE_URL.replace(/\/$/, '')
  const query = [
    `name=${encodeURIComponent(params.name)}`,
    `roomPassword=${encodeURIComponent(params.roomPassword ?? '0')}`,
    `audio=${params.audio !== false ? '1' : '0'}`,
    `video=${params.video !== false ? '1' : '0'}`,
    `screen=${params.screen ? '1' : '0'}`,
    `notify=${params.notify !== false ? '1' : '0'}`
  ]
  if (params.hide !== undefined) query.push(`hide=${params.hide ? '1' : '0'}`)
  if (params.token) query.push(`token=${encodeURIComponent(params.token)}`)
  return `${base}/meet/${encodeURIComponent(params.room)}&${query.join('&')}`
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
