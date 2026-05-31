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
})
