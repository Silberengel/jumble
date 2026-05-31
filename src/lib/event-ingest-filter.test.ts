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
