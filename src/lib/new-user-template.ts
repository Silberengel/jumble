import {
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS
} from '@/constants'
import {
  createFavoriteRelaysDraftEvent,
  createFollowListDraftEvent,
  createHttpRelayListDraftEvent,
  createInterestListDraftEvent,
  createMuteListDraftEvent,
  createProfileDraftEvent,
  createRelayListDraftEvent
} from '@/lib/draft-event'
import { TDraftEvent, TMailboxRelay } from '@/types'

export const NEW_USER_HTTP_RELAY_URL = 'https://mercury-relay.imwald.eu/'

export const NEW_USER_INTEREST_TOPICS = [
  'art',
  'music',
  'news',
  'foodstr',
  'coffeechain',
  'travel',
  'grownostr',
  'plebchain'
] as const

export const NEW_USER_PROFILE_ABOUT = 'New on Nostr via Imwald. Edit your profile in Settings.'

/** Stable 4-digit suffix (1000–9999) from pubkey hex. */
export function newUserProfileSuffix(pubkey: string): number {
  const hex = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    return 1000
  }
  return (parseInt(hex.slice(-4), 16) % 9000) + 1000
}

export function newUserProfileName(pubkey: string): string {
  return `ImwaldUser${newUserProfileSuffix(pubkey)}`
}

export function newUserProfileDisplayName(pubkey: string): string {
  return `Imwald User ${newUserProfileSuffix(pubkey)}`
}

export function buildNewUserMailboxRelays(): TMailboxRelay[] {
  return [
    ...FAST_READ_RELAY_URLS.map((url) => ({ url, scope: 'read' as const })),
    ...FAST_WRITE_RELAY_URLS.map((url) => ({ url, scope: 'write' as const }))
  ]
}

export function buildNewUserProfileDraft(pubkey: string): TDraftEvent {
  const content = JSON.stringify({
    name: newUserProfileName(pubkey),
    display_name: newUserProfileDisplayName(pubkey),
    about: NEW_USER_PROFILE_ABOUT
  })
  return createProfileDraftEvent(content)
}

export function buildNewUserFavoriteRelaysDraft(): TDraftEvent {
  return createFavoriteRelaysDraftEvent([...DEFAULT_FAVORITE_RELAYS], [])
}

export function buildNewUserRelayListDraft(): TDraftEvent {
  return createRelayListDraftEvent(buildNewUserMailboxRelays())
}

export function buildNewUserHttpRelayListDraft(): TDraftEvent {
  return createHttpRelayListDraftEvent([{ url: NEW_USER_HTTP_RELAY_URL, scope: 'both' }])
}

export function buildNewUserInterestListDraft(): TDraftEvent {
  return createInterestListDraftEvent([...NEW_USER_INTEREST_TOPICS])
}

export function buildNewUserFollowListDraft(): TDraftEvent {
  return createFollowListDraftEvent([])
}

export function buildNewUserMuteListDraft(): TDraftEvent {
  return createMuteListDraftEvent([])
}

export type TNewUserTemplateDrafts = {
  profile: TDraftEvent
  favoriteRelays: TDraftEvent
  relayList: TDraftEvent
  httpRelayList: TDraftEvent
  interestList: TDraftEvent
  followList: TDraftEvent
  muteList: TDraftEvent
}

export function buildNewUserTemplateDrafts(pubkey: string): TNewUserTemplateDrafts {
  return {
    profile: buildNewUserProfileDraft(pubkey),
    favoriteRelays: buildNewUserFavoriteRelaysDraft(),
    relayList: buildNewUserRelayListDraft(),
    httpRelayList: buildNewUserHttpRelayListDraft(),
    interestList: buildNewUserInterestListDraft(),
    followList: buildNewUserFollowListDraft(),
    muteList: buildNewUserMuteListDraft()
  }
}
