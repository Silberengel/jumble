import { describe, expect, it } from 'vitest'
import {
  buildWispTrendingNotesRelayUrl,
  ensureTrendingInFavoriteRelayList,
  isWispTrendingNotesRelayUrl
} from '@/lib/wisp-trending-relay'
import { setViewerPersonalRelayKeys } from '@/lib/read-only-relay-personal'

describe('ensureTrendingInFavoriteRelayList', () => {
  const defaultTrending = buildWispTrendingNotesRelayUrl()

  it('appends default trending when missing', () => {
    const out = ensureTrendingInFavoriteRelayList(['wss://relay.example.com/'])
    expect(out).toEqual(['wss://relay.example.com/', defaultTrending])
  })

  it('does not duplicate when default trending is already listed', () => {
    const out = ensureTrendingInFavoriteRelayList([
      'wss://relay.example.com/',
      defaultTrending
    ])
    expect(out).toHaveLength(2)
    expect(out.some(isWispTrendingNotesRelayUrl)).toBe(true)
  })

  it('keeps a single trending entry when another Wisp path is already present', () => {
    const customTrending = buildWispTrendingNotesRelayUrl('replies', '7d')
    const out = ensureTrendingInFavoriteRelayList([
      'wss://relay.example.com/',
      customTrending,
      defaultTrending
    ])
    expect(out.filter(isWispTrendingNotesRelayUrl)).toEqual([customTrending])
  })

  it('forFeed skips injection under metadata-relays-only policy', () => {
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    const out = ensureTrendingInFavoriteRelayList(['wss://relay.example.com/'], { forFeed: true })
    expect(out).toEqual(['wss://relay.example.com/'])
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })
})
