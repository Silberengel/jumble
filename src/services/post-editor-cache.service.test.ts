import { afterEach, describe, expect, it } from 'vitest'
import postEditorCache from '@/services/post-editor-cache.service'
import { plainTextToTipTapDoc } from '@/lib/tiptap'

describe('PostEditorCacheService — quote / defaultContent', () => {
  afterEach(() => {
    postEditorCache.clearAllPostCaches()
  })

  it('getPostContentCache ignores an empty cached doc when defaultContent is set (re-seed quote)', () => {
    const params = { kind: 1 as const, defaultContent: '\nnostr:nevent1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }
    postEditorCache.setPostContentCache(params, plainTextToTipTapDoc(''))
    const got = postEditorCache.getPostContentCache(params)
    expect(typeof got).toBe('string')
    expect(got).toContain('nostr:')
  })

  it('setPostContentCache does not persist an empty body when defaultContent is set', () => {
    const params = { kind: 1 as const, defaultContent: '\nnostr:nevent1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }
    postEditorCache.setPostContentCache(params, plainTextToTipTapDoc(''))
    expect(postEditorCache.getPostContentCache(params)).toContain('nostr:')
  })

  it('quote seed does not reuse a blank new-note draft cache', () => {
    postEditorCache.setPostContentCache({ kind: 1 }, plainTextToTipTapDoc('Its the spam filter draft'))
    const quoteParams = {
      kind: 1 as const,
      defaultContent: '\nnostr:nevent1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
    }
    const got = postEditorCache.getPostContentCache(quoteParams)
    expect(typeof got).toBe('string')
    expect(String(got)).toContain('nostr:nevent1')
    expect(String(got)).not.toContain('spam filter')
  })
})
