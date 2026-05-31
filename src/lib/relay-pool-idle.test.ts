import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { PROFILE_RELAY_URLS } from '@/constants'
import { setViewerPersonalRelayKeys } from '@/lib/read-only-relay-personal'
import {
  closePublishTransientRelaySockets,
  initRelayPoolIdle,
  resetRelayPoolIdleForTests
} from './relay-pool-idle'

describe('relay-pool-idle publish cleanup', () => {
  const closed: string[] = []
  const pool = {
    listConnectionStatus: () =>
      new Map([
        ['wss://author-outbox.example/', true],
        ['wss://relay.example.com/', true],
        [PROFILE_RELAY_URLS[0]!, true]
      ]),
    close: (urls: string[]) => {
      closed.push(...urls)
    }
  }

  beforeEach(() => {
    closed.length = 0
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    initRelayPoolIdle(pool as never, () => false)
  })

  afterEach(() => {
    resetRelayPoolIdleForTests()
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })

  it('closes author/random publish relays but keeps personal and profile index', () => {
    closePublishTransientRelaySockets([
      'wss://author-outbox.example/',
      'wss://relay.example.com/',
      PROFILE_RELAY_URLS[0]!
    ])
    expect(closed).toEqual(['wss://author-outbox.example/'])
  })

  it('skips relays that still have active subscriptions', () => {
    resetRelayPoolIdleForTests()
    initRelayPoolIdle(pool as never, (key) => key.includes('author-outbox'))
    closePublishTransientRelaySockets(['wss://author-outbox.example/'])
    expect(closed).toEqual([])
  })
})
