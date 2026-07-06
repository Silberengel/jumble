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

  it('dedupeGifsByUrl collapses different URLs sharing the same media sha256, preferring kind 1090', () => {
    const hash = 'f'.repeat(64)
    const legacy1063 = {
      url: 'https://host-a.example/animation.gif',
      sha256: hash,
      sourceKind: ExtendedKind.FILE_METADATA,
      eventId: '1063-1',
      pubkey: 'a'.repeat(64),
      createdAt: 500
    }
    const clip1090 = {
      url: `https://host-b.example/${hash}.webp`,
      sha256: hash,
      emotions: ['disbelief'],
      sourceKind: ExtendedKind.REACTION_CLIP,
      eventId: '1090-1',
      pubkey: 'b'.repeat(64),
      createdAt: 100
    }
    const unrelated = {
      url: 'https://host-c.example/other.gif',
      sourceKind: ExtendedKind.FILE_METADATA,
      eventId: '1063-2',
      pubkey: 'c'.repeat(64),
      createdAt: 200
    }
    const merged = dedupeGifsByUrl([legacy1063, clip1090, unrelated])
    expect(merged).toHaveLength(2)
    expect(merged.find((g) => g.sha256 === hash)?.eventId).toBe('1090-1')
    expect(merged.some((g) => g.eventId === '1063-2')).toBe(true)
  })

  it('dedupeGifsByUrl merge keeps unique URLs from both relay and existing cache', () => {
    const existing = [
      {
        url: 'https://cdn.example/a.gif',
        sourceKind: ExtendedKind.FILE_METADATA,
        eventId: 'a',
        pubkey: 'a'.repeat(64),
        createdAt: 100
      },
      {
        url: 'https://cdn.example/b.gif',
        sourceKind: ExtendedKind.FILE_METADATA,
        eventId: 'b',
        pubkey: 'a'.repeat(64),
        createdAt: 200
      }
    ]
    const incoming = [
      {
        url: 'https://cdn.example/b.gif',
        sourceKind: ExtendedKind.FILE_METADATA,
        eventId: 'b-new',
        pubkey: 'b'.repeat(64),
        createdAt: 300
      },
      {
        url: 'https://cdn.example/c.gif',
        sourceKind: ExtendedKind.FILE_METADATA,
        eventId: 'c',
        pubkey: 'c'.repeat(64),
        createdAt: 400
      }
    ]
    const merged = dedupeGifsByUrl([...incoming, ...existing])
    expect(merged).toHaveLength(3)
    expect(merged.map((g) => g.url).sort()).toEqual([
      'https://cdn.example/a.gif',
      'https://cdn.example/b.gif',
      'https://cdn.example/c.gif'
    ])
    expect(merged.find((g) => g.url === 'https://cdn.example/b.gif')?.eventId).toBe('b-new')
  })
})
