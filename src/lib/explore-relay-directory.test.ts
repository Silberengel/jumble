import { describe, expect, it } from 'vitest'
import { buildExploreRelayDirectory, scoreExploreRelayEntry } from './explore-relay-directory'

describe('scoreExploreRelayEntry', () => {
  it('ranks mailbox read above following-only social proof', () => {
    const mailboxOnly = scoreExploreRelayEntry(
      {
        inMailboxRead: true,
        inMailboxWrite: false,
        inMailboxHttpRead: false,
        inUserFavorites: false,
        inAppDefaults: false,
        inFastRead: false,
        inNip66Cache: false
      },
      0,
      0,
      1
    )
    const socialOnly = scoreExploreRelayEntry(
      {
        inMailboxRead: false,
        inMailboxWrite: false,
        inMailboxHttpRead: false,
        inUserFavorites: false,
        inAppDefaults: false,
        inFastRead: false,
        inNip66Cache: false
      },
      25,
      0,
      1
    )
    expect(mailboxOnly).toBeGreaterThan(socialOnly)
  })
})

describe('buildExploreRelayDirectory', () => {
  it('dedupes URLs and sorts client inbox before following-only relays', () => {
    const relay = 'wss://inbox.example.com/'
    const entries = buildExploreRelayDirectory({
      relayList: { read: [relay], write: [], httpRead: [] },
      favoriteRelays: [],
      blockedRelays: [],
      followingFavorites: [['wss://social.example.com', ['aa', 'bb', 'cc']]],
      max: 50
    })
    expect(entries[0]?.url).toBe(relay)
    const social = entries.find((e) => e.url.includes('social.example.com'))
    expect(social).toBeDefined()
    expect(entries.find((e) => e.url === relay)?.favoritedBy).toEqual([])
    expect(social?.favoritedBy).toHaveLength(3)
  })
})
