import { describe, expect, it } from 'vitest'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import type { Event } from 'nostr-tools'

const DRIFT_GITS_SPAM: Event = {
  kind: 1,
  content:
    'sp_4c43bd1d.949ac75f.06.OHCFKDGO2J6TV4KYHAB2JBLIMXHR6RQWVYAGRVBPBUKCH6CPR7JJU3PMG4SBCQA.drift.gits.net',
  created_at: 1780215168,
  id: '00f077ecb154545e5a5ae98b1fe28db5e30661e2cad5c714c6b2b8d9a81c774a',
  pubkey: '53ce12f561b8ecf9e20ae19acb0201bdc661d9e36801b47a642d9f8fdb01a245',
  sig: '72bb0acfe6174a51ab176b3bf178ebcaf648e4427fb5b5500341af1603be420509d833e56e4e4315b7f6a30f6223ea85475f0f2946dbad23dc6cf95959ce9646',
  tags: [
    ['t', 'sp_4c43bd1d'],
    ['nonce', '3559b6bd', '8']
  ]
}

const BASE64_BLOB_SPAM: Event = {
  kind: 1,
  content:
    'yBH9z+dFkrjXwdWnT43WlzguqTlaMEaeVr2+2A5cJKpbgnSxuU/rstTbQzkb1ormLJOt6ary5iWeBVul1xHFgMzVFlnDeIrUyOGeMIBu18gwTlOyJ4NY4RsmegRYivAoej1Hik+ifi5DmXYQN3dsIiz2xYqMiks+uegscL71yY2QZOA=',
  created_at: 1780215178,
  id: '6b5451748d2aa66c699b99d343275d161708a0692b3edd95dcc162409bd8e0c6',
  pubkey: '3ccf8522563127b37aaf0cafd0545851d9d1f6a62033ce373636b2fb72a2ffdf',
  sig: '960d9c5fe890de907e2ebe922d4a3101670add71306d3f55f066b11c301f457b3635e305a5487a3c8bdad3c5405bab3bca26623ccbd56753c13c5e68b400c20e',
  tags: []
}

describe('shouldDropEventOnIngest', () => {
  it('drops drift.gits.net kind-1 spam', () => {
    expect(shouldDropEventOnIngest(DRIFT_GITS_SPAM)).toBe(true)
  })

  it('allows drift.gits.net spam on explicit note lookup', () => {
    expect(
      shouldDropEventOnIngest(DRIFT_GITS_SPAM, {
        explicitNoteLookupHexId: DRIFT_GITS_SPAM.id
      })
    ).toBe(false)
  })

  it('drops long base64-like kind-1 blobs ending with =', () => {
    expect(shouldDropEventOnIngest(BASE64_BLOB_SPAM)).toBe(true)
  })

  it('allows long base64 blob on explicit note lookup', () => {
    expect(
      shouldDropEventOnIngest(BASE64_BLOB_SPAM, {
        explicitNoteLookupHexId: BASE64_BLOB_SPAM.id
      })
    ).toBe(false)
  })

  it('does not drop short kind-1 text ending with =', () => {
    expect(
      shouldDropEventOnIngest({
        ...BASE64_BLOB_SPAM,
        content: 'x=3',
        tags: []
      })
    ).toBe(false)
  })

  it('does not drop normal kind-1 text', () => {
    expect(
      shouldDropEventOnIngest({
        ...DRIFT_GITS_SPAM,
        content: 'Hello nostr',
        tags: []
      })
    ).toBe(false)
  })

  it('drops kind-1 notes with far-future created_at', () => {
    const spam: Event = {
      kind: 1,
      content: 'test',
      created_at: 4_130_944_797,
      id: '2f99b9a8418df688728fbc763cd442e9ab6e570b4fa362abfc4bf8cb9f030b60',
      pubkey: '394b6923d5bc126cd42ec1a645f04c3ab7e2d62a80b15bf077d6bb6a6bd9a9b7',
      sig: 'ca467c72557efd49293c687bd0c5858ba92168f9a057bd0cedb2a1d8eb5cbb5f22202eddaa5ccaa8ef2a54e68eea12850bafa009cbcd0fb24a1a8afa49675455',
      tags: []
    }
    expect(shouldDropEventOnIngest(spam)).toBe(true)
  })

  it('still drops far-future created_at on explicit note lookup', () => {
    expect(
      shouldDropEventOnIngest(
        {
          kind: 1,
          content: 'test',
          created_at: 4_130_944_797,
          id: '2f99b9a8418df688728fbc763cd442e9ab6e570b4fa362abfc4bf8cb9f030b60',
          pubkey: '394b6923d5bc126cd42ec1a645f04c3ab7e2d62a80b15bf077d6bb6a6bd9a9b7',
          sig: 'ca467c72557efd49293c687bd0c5858ba92168f9a057bd0cedb2a1d8eb5cbb5f22202eddaa5ccaa8ef2a54e68eea12850bafa009cbcd0fb24a1a8afa49675455',
          tags: []
        },
        { explicitNoteLookupHexId: '2f99b9a8418df688728fbc763cd442e9ab6e570b4fa362abfc4bf8cb9f030b60' }
      )
    ).toBe(true)
  })
})
