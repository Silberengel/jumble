import { describe, expect, it } from 'vitest'
import {
  appendContentWarningTagIfNeeded,
  contentWarningDraftOptions,
  mergeContentWarningTagsFromDraftOptions
} from '@/lib/content-warning'

describe('content-warning draft helpers', () => {
  it('defaults to NSFW when enabled without an explicit label', () => {
    expect(contentWarningDraftOptions(true, '')).toEqual({
      isNsfw: true,
      contentWarningLabel: 'NSFW'
    })
  })

  it('appends the selected label when enabled', () => {
    const tags: string[][] = []
    appendContentWarningTagIfNeeded(tags, contentWarningDraftOptions(true, 'Violence'))
    expect(tags).toEqual([['content-warning', 'Violence']])
  })

  it('does not append a tag when disabled', () => {
    const tags: string[][] = []
    appendContentWarningTagIfNeeded(tags, contentWarningDraftOptions(false, 'NSFW'))
    expect(tags).toEqual([])
  })

  it('replaces manual lab content-warning tags with composer settings', () => {
    const tags: string[][] = [['content-warning', 'Spoilers'], ['t', 'test']]
    mergeContentWarningTagsFromDraftOptions(tags, contentWarningDraftOptions(true, 'Violence'))
    expect(tags).toEqual([['t', 'test'], ['content-warning', 'Violence']])

    mergeContentWarningTagsFromDraftOptions(tags, contentWarningDraftOptions(false, ''))
    expect(tags).toEqual([['t', 'test']])
  })
})
