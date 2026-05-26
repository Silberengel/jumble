import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { relayUrlsLocalsFirst } from '@/lib/relay-url-priority'
import { collectReadInboxUrlsFromRelayList } from '@/lib/viewer-read-inboxes'
import { stripMailboxLocalUrlsForRemoteViewers } from '@/lib/relay-list-sanitize'
import { normalizeAnyRelayUrl } from '@/lib/url'

const PROFILE_REPORTS_MAX_RELAYS = 24

export type ProfileReportsRelayList = {
  read?: string[]
  write?: string[]
  httpRead?: string[]
  httpWrite?: string[]
}

/**
 * Profile Reports tab: subject's NIP-65 inboxes + HTTP index (`httpRead`), optional kind-10432 cache relays (own profile only).
 * No favorites / fast-read widening — only the user's mailbox stack.
 */
export function buildProfileReportsRelayUrls(
  authorRelayList: ProfileReportsRelayList,
  blockedRelays: string[],
  options: {
    includeAuthorLocalRelays?: boolean
    cacheRelayUrls?: readonly string[]
  } = {}
): string[] {
  const blocked = new Set(
    blockedRelays.map((b) => normalizeAnyRelayUrl(b) || b).filter(Boolean)
  )
  const mailboxList = {
    read: authorRelayList.read ?? [],
    write: authorRelayList.write ?? [],
    httpRead: authorRelayList.httpRead,
    httpWrite: authorRelayList.httpWrite
  }
  const list = options.includeAuthorLocalRelays
    ? mailboxList
    : stripMailboxLocalUrlsForRemoteViewers(mailboxList)
  const inboxLayer = relayUrlsLocalsFirst(collectReadInboxUrlsFromRelayList(list))
  const cacheLayer = relayUrlsLocalsFirst(
    (options.cacheRelayUrls ?? []).filter((u) => {
      const k = normalizeAnyRelayUrl(u) || u.trim()
      return k.length > 0 && !blocked.has(k)
    })
  )
  return feedRelayPolicyUrls(
    [
      { source: 'cache', urls: cacheLayer, explicit: true },
      { source: 'inbox', urls: inboxLayer }
    ],
    {
      operation: 'read',
      blockedRelays,
      maxRelays: PROFILE_REPORTS_MAX_RELAYS,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: options.includeAuthorLocalRelays ?? false
    }
  )
}
