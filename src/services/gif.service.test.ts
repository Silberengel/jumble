import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import {
  dedupeGifsByUrl,
  getGif1063RelayUrls,
  sortGifsForPicker,
  type GifMetadata
} from './gif.service'

describe('gif.service', () => {
  it('getGif1063RelayUrls returns deduped GIF relay constants', () => {
    const urls = getGif1063RelayUrls()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.some((u) => u.includes('thecitadel'))).toBe(true)
    expect(urls.some((u) => u.includes('relay.gifbuddy.lol'))).toBe(true)
  })

  it('sortGifsForPicker orders own, follows, then others', () => {
    const me = 'a'.repeat(64)
    const follow = 'b'.repeat(64)
    const other = 'c'.repeat(64)
    const mk = (pubkey: string, createdAt: number): GifMetadata => ({
      url: `https://example.com/${pubkey.slice(0, 4)}.gif`,
      sourceKind: ExtendedKind.FILE_METADATA,
      eventId: `${pubkey}-${createdAt}`,
      pubkey,
      createdAt
    })
    const gifs = [
      mk(other, 300),
      mk(follow, 200),
      mk(me, 100),
      mk(me, 400),
      mk(follow, 500)
    ]
    const sorted = sortGifsForPicker(gifs, me, [follow])
    expect(sorted.map((g) => g.pubkey)).toEqual([
      me,
      me,
      follow,
      follow,
      other
    ])
    expect(sorted[0]!.createdAt).toBe(400)
    expect(sorted[1]!.createdAt).toBe(100)
  })

  it('dedupeGifsByUrl keeps kind 1063 over kind 1 and 1111 for the same URL', () => {
    const url = 'https://cdn.example/animation.gif'
    const note = {
      url,
      sourceKind: kinds.ShortTextNote,
      eventId: 'note-1',
      pubkey: 'a'.repeat(64),
      createdAt: 200
    }
    const comment = {
      url,
      sourceKind: ExtendedKind.COMMENT,
      eventId: 'comment-1',
      pubkey: 'a'.repeat(64),
      createdAt: 300
    }
    const fileMeta = {
      url,
      sourceKind: ExtendedKind.FILE_METADATA,
      eventId: '1063-1',
      pubkey: 'a'.repeat(64),
      createdAt: 100
    }
    expect(dedupeGifsByUrl([note, comment, fileMeta])).toEqual([fileMeta])
    expect(dedupeGifsByUrl([note, comment])).toEqual([comment])
  })
})
