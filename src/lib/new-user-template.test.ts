import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { ExtendedKind, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import { NEW_USER_HTTP_RELAY_URL, buildNewUserTemplateDrafts, newUserProfileDisplayName, newUserProfileName, newUserProfileSuffix } from '@/lib/new-user-template'
import { newUserTemplatePublishRelays } from '@/lib/new-user-template-broadcast'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

const TEST_PUBKEY = 'a'.repeat(63) + 'b'

function relayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url).toLowerCase()
}

function expectRelayKeys(actual: string[], expected: string[]) {
  const actualKeys = new Set(actual.map(relayKey))
  for (const url of expected) {
    expect(actualKeys.has(relayKey(url))).toBe(true)
  }
}

const templateRelayList = (): TRelayList => ({
  write: [...FAST_WRITE_RELAY_URLS],
  read: [...FAST_READ_RELAY_URLS],
  originalRelays: [],
  httpRead: [],
  httpWrite: [NEW_USER_HTTP_RELAY_URL],
  httpOriginalRelays: []
})

describe('newUserProfileSuffix', () => {
  it('returns a number between 1000 and 9999', () => {
    const suffix = newUserProfileSuffix(TEST_PUBKEY)
    expect(suffix).toBeGreaterThanOrEqual(1000)
    expect(suffix).toBeLessThanOrEqual(9999)
  })

  it('formats profile names with the suffix', () => {
    const suffix = newUserProfileSuffix(TEST_PUBKEY)
    expect(newUserProfileName(TEST_PUBKEY)).toBe(`ImwaldUser${suffix}`)
    expect(newUserProfileDisplayName(TEST_PUBKEY)).toBe(`Imwald User ${suffix}`)
  })
})

describe('buildNewUserTemplateDrafts', () => {
  const drafts = buildNewUserTemplateDrafts(TEST_PUBKEY)

  it('builds profile kind 0 with unique names', () => {
    expect(drafts.profile.kind).toBe(kinds.Metadata)
    const profile = JSON.parse(drafts.profile.content)
    expect(profile.name).toBe(newUserProfileName(TEST_PUBKEY))
    expect(profile.display_name).toBe(newUserProfileDisplayName(TEST_PUBKEY))
    expect(profile.about).toContain('Imwald')
  })

  it('builds favorite relays kind 10012', () => {
    expect(drafts.favoriteRelays.kind).toBe(ExtendedKind.FAVORITE_RELAYS)
    expect(drafts.favoriteRelays.tags.filter((t) => t[0] === 'relay')).toHaveLength(2)
  })

  it('splits mailbox read and write relays', () => {
    expect(drafts.relayList.kind).toBe(kinds.RelayList)
    const readTags = drafts.relayList.tags.filter((t) => t[0] === 'r' && t[2] === 'read')
    const writeTags = drafts.relayList.tags.filter((t) => t[0] === 'r' && t[2] === 'write')
    expect(readTags).toHaveLength(FAST_READ_RELAY_URLS.length)
    expect(writeTags).toHaveLength(FAST_WRITE_RELAY_URLS.length)
  })

  it('builds HTTP relay list kind 10243 with mercury', () => {
    expect(drafts.httpRelayList.kind).toBe(ExtendedKind.HTTP_RELAY_LIST)
    expect(drafts.httpRelayList.tags.some((t) => t[1]?.includes('mercury-relay.imwald.eu'))).toBe(true)
  })

  it('builds interest list with expected topics', () => {
    expect(drafts.interestList.kind).toBe(10015)
    const topics = drafts.interestList.tags.filter((t) => t[0] === 't').map((t) => t[1])
    expect(topics).toEqual([
      'art',
      'music',
      'news',
      'foodstr',
      'coffeechain',
      'travel',
      'grownostr',
      'plebchain'
    ])
  })

  it('builds empty follow and mute lists', () => {
    expect(drafts.followList.kind).toBe(kinds.Contacts)
    expect(drafts.followList.tags).toHaveLength(0)
    expect(drafts.muteList.kind).toBe(10000)
    expect(drafts.muteList.tags).toHaveLength(0)
  })
})

describe('newUserTemplatePublishRelays', () => {
  const relayList = templateRelayList()

  it('uses template write outboxes only for list kinds', () => {
    const targets = newUserTemplatePublishRelays(10015, relayList)
    expectRelayKeys(targets, [...FAST_WRITE_RELAY_URLS, NEW_USER_HTTP_RELAY_URL])
    const profileOnlyUrls = PROFILE_RELAY_URLS.filter((u) => !FAST_WRITE_RELAY_URLS.includes(u))
    for (const profileUrl of profileOnlyUrls) {
      expect(targets.map(relayKey)).not.toContain(relayKey(profileUrl))
    }
  })

  it('adds profile relays for kind 0 and 10002', () => {
    const profileTargets = newUserTemplatePublishRelays(kinds.Metadata, relayList)
    expectRelayKeys(profileTargets, [...FAST_WRITE_RELAY_URLS, NEW_USER_HTTP_RELAY_URL, ...PROFILE_RELAY_URLS])
    const relayListTargets = newUserTemplatePublishRelays(kinds.RelayList, relayList)
    expectRelayKeys(relayListTargets, [...FAST_WRITE_RELAY_URLS, NEW_USER_HTTP_RELAY_URL, ...PROFILE_RELAY_URLS])
  })
})
