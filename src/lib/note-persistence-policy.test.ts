import { StorageKey } from '@/constants'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  bindLightArchiveCacheRelayUrls,
  getNotePersistencePolicy,
  isLightArchiveActiveSync
} from '@/lib/note-persistence-policy'

describe('note-persistence-policy', () => {
  beforeEach(() => {
    bindLightArchiveCacheRelayUrls([])
    window.localStorage.removeItem(StorageKey.CACHE_RELAYS_ENABLED)
  })

  it('light mode requires cache relay toggle and URLs', () => {
    window.localStorage.setItem(StorageKey.CACHE_RELAYS_ENABLED, 'true')
    expect(isLightArchiveActiveSync()).toBe(false)
    bindLightArchiveCacheRelayUrls(['ws://127.0.0.1:4869'])
    expect(isLightArchiveActiveSync()).toBe(true)
  })

  it('light mode skips bulk feed archive writes', () => {
    window.localStorage.setItem(StorageKey.CACHE_RELAYS_ENABLED, 'true')
    bindLightArchiveCacheRelayUrls(['ws://localhost:4869'])
    const policy = getNotePersistencePolicy()
    expect(policy.lightArchive).toBe(true)
    expect(policy.persistFeedNotesToArchive).toBe(false)
    expect(policy.scanArchiveOnLocalFeed).toBe(false)
    expect(policy.foregroundMicroArchive).toBe(true)
  })

  it('full mode persists feed notes to archive', () => {
    const policy = getNotePersistencePolicy()
    expect(policy.lightArchive).toBe(false)
    expect(policy.persistFeedNotesToArchive).toBe(true)
    expect(policy.scanArchiveOnLocalFeed).toBe(true)
  })
})
