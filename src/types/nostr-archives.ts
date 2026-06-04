import type { Event } from 'nostr-tools'

/** Result of an Archives HTTP call — never throws; UI uses relay/local fallbacks when `ok` is false. */
export type TArchivesApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      reason:
        | 'disabled'
        | 'circuit_open'
        | 'rate_limited'
        | 'network'
        | 'timeout'
        | 'http'
        | 'not_found'
        | 'parse'
      status?: number
    }

export type TArchivesInteractionCounts = {
  reactions: number
  replies: number
  reposts: number
  zap_sats: number
}

export type TArchivesSocialGraph = {
  pubkey: string
  follows: { count: number; pubkeys: string[] }
  followers: { count: number; pubkeys: string[] }
}

export type TArchivesProfileMetadata = {
  pubkey: string
  display_name?: string
  name?: string
  preferred_name?: string
  picture?: string
  about?: string
  nip05?: string
  lud16?: string
  follower_count?: number
}

export type TArchivesNotePageBundle = {
  event: Event
  replies: Event[]
  profiles: Record<string, TArchivesProfileMetadata>
  interactions: TArchivesInteractionCounts
}
