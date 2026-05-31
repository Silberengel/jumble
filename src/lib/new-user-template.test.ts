import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { ExtendedKind, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import {
  NEW_USER_INTEREST_TOPICS,
  buildNewUserTemplateDrafts,
  newUserProfileDisplayName,
  newUserProfileName,
  newUserProfileSuffix
} from '@/lib/new-user-template'

const TEST_PUBKEY = 'a'.repeat(63) + 'b'

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
    expect(topics).toEqual([...NEW_USER_INTEREST_TOPICS])
  })

  it('builds empty follow and mute lists', () => {
    expect(drafts.followList.kind).toBe(kinds.Contacts)
    expect(drafts.followList.tags).toHaveLength(0)
    expect(drafts.muteList.kind).toBe(10000)
    expect(drafts.muteList.tags).toHaveLength(0)
  })
})
