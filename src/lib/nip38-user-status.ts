import { ExtendedKind } from '@/constants'
import dayjs from 'dayjs'
import type { Event } from 'nostr-tools'

/** NIP-38 status types defined by the spec. */
export const NIP38_USER_STATUS_TYPES = ['general', 'music'] as const

export type Nip38UserStatusType = (typeof NIP38_USER_STATUS_TYPES)[number]

export type TUserStatus = {
  type: string
  content: string
  linkTag?: 'r' | 'p' | 'e' | 'a'
  linkValue?: string
  expiration?: number
  createdAt: number
  event: Event
}

function firstTagValue(ev: Event, name: string): string | undefined {
  for (const t of ev.tags) {
    if (t[0] === name && t[1]) return t[1]
  }
  return undefined
}

export function userStatusDTag(event: Event): string | undefined {
  if (event.kind !== ExtendedKind.USER_STATUS) return undefined
  return firstTagValue(event, 'd')
}

export function isUserStatusExpired(event: Event, nowUnix = dayjs().unix()): boolean {
  const raw = firstTagValue(event, 'expiration')
  if (!raw) return false
  const exp = parseInt(raw, 10)
  if (Number.isNaN(exp)) return false
  return nowUnix > exp
}

export function parseUserStatusEvent(event: Event): TUserStatus | null {
  if (event.kind !== ExtendedKind.USER_STATUS) return null
  const type = userStatusDTag(event)
  if (!type) return null
  const content = event.content ?? ''
  if (!content.trim()) return null
  if (isUserStatusExpired(event)) return null

  let linkTag: TUserStatus['linkTag']
  let linkValue: string | undefined
  for (const name of ['r', 'p', 'e', 'a'] as const) {
    const v = firstTagValue(event, name)
    if (v) {
      linkTag = name
      linkValue = v
      break
    }
  }

  const expRaw = firstTagValue(event, 'expiration')
  const expiration = expRaw ? parseInt(expRaw, 10) : undefined

  return {
    type,
    content: content.trim(),
    linkTag,
    linkValue,
    expiration: expiration && !Number.isNaN(expiration) ? expiration : undefined,
    createdAt: event.created_at,
    event
  }
}

export function userStatusLinkHref(status: TUserStatus): string | undefined {
  if (!status.linkValue) return undefined
  if (status.linkTag === 'r') {
    const v = status.linkValue.trim()
    if (/^https?:\/\//i.test(v)) return v
    return undefined
  }
  return undefined
}

export type UserStatusDraftInput = {
  type: string
  content: string
  linkUrl?: string
  /** Unix seconds; omit for no expiration. */
  expiration?: number
}

export function buildUserStatusTags(input: UserStatusDraftInput): string[][] {
  const tags: string[][] = [['d', input.type.trim()]]
  const link = input.linkUrl?.trim()
  if (link) tags.push(['r', link])
  if (input.expiration != null && input.expiration > 0) {
    tags.push(['expiration', String(Math.floor(input.expiration))])
  }
  return tags
}
