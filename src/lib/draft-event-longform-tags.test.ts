import { createLongFormArticleDraftEvent } from '@/lib/draft-event'
import client from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('createLongFormArticleDraftEvent t-tag dedupe', () => {
  beforeEach(() => {
    vi.spyOn(client, 'getEventHint').mockReturnValue('')
  })

  it('does not double t-tags when topics appear both in content hashtags and options.topics', async () => {
    const topics = ['nostr', 'bitcoin', 'privacy', 'opensource', 'relay']
    const content = topics.map((t) => `#${t}`).join(' ')

    const draft = await createLongFormArticleDraftEvent(content, [], {
      dTag: 'test-article',
      title: 'Test',
      topics
    })

    expect(draft.kind).toBe(kinds.LongFormArticle)
    const tTags = draft.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1])
    expect(tTags).toHaveLength(5)
    expect(new Set(tTags).size).toBe(5)
    for (const topic of topics) {
      expect(tTags).toContain(topic)
    }
  })

  it('dedupes repeated hashtags within content', async () => {
    const draft = await createLongFormArticleDraftEvent('#nostr hello #nostr again #Nostr', [], {
      dTag: 'repeat-hashtags'
    })

    const tTags = draft.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1])
    expect(tTags).toEqual(['nostr'])
  })
})
