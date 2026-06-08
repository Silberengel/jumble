import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildEngagementMapsFromEvents,
  buildLibraryPublicationRelaySearchFilters,
  buildRecentPublicationEntries,
  clearLibrarySearchSessionCache,
  computeLibraryFeedRootOrder,
  filterEngagedPublications,
  filterLibraryPublicationsBySearch,
  filterLibraryPublicationsByUser,
  libraryDefaultFeedSlice,
  libraryPublicationEntriesForUserFromIndex,
  LIBRARY_PAGE_SIZE,
  pickLibraryPublicationEntries,
  publicationRootBelongsToUser,
  peekLibrarySearchResults,
  publicationIndexMatchesSearchQuery,
  publicationQueryDTagVariants,
  searchLibraryPublicationIndex,
  searchLibraryPublications
} from '@/lib/library-publication-index'
import { buildIndexByAddress } from '@/lib/publication-index'
import type { Event } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey, kinds } from 'nostr-tools'

const sk = generateSecretKey()
const PK = getPublicKey(sk)

function indexEvent(
  d: string,
  aTags: string[],
  opts?: { created_at?: number }
): Event {
  return finalizeEvent(
    {
      kind: ExtendedKind.PUBLICATION,
      created_at: opts?.created_at ?? 100,
      content: '',
      tags: [['d', d], ['title', `Title ${d}`], ...aTags.map((a) => ['a', a] as [string, string])]
    },
    sk
  )
}

describe('library-publication-index', () => {
  it('matches comments and highlights by root event id', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const indexByAddress = buildIndexByAddress([root])
    const comment: Event = {
      id: '8'.repeat(64),
      kind: ExtendedKind.COMMENT,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: 'nice book',
      tags: [['e', root.id]],
      sig: 'e'.repeat(128)
    }
    const highlight: Event = {
      id: '9'.repeat(64),
      kind: kinds.Highlights,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: 'quote',
      tags: [['e', root.id]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([], [comment], [highlight])
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasComment).toBe(true)
    expect(engaged[0].hasHighlight).toBe(true)
  })

  it('matches bookmark and pin lists from any author', () => {
    const rootAddr = `30040:${PK}:book`
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const indexByAddress = buildIndexByAddress([root])
    const bookmarkList: Event = {
      id: 'b'.repeat(64),
      kind: kinds.BookmarkList,
      pubkey: 'f'.repeat(64),
      created_at: 100,
      content: '',
      tags: [['a', rootAddr]],
      sig: 'd'.repeat(128)
    }
    const pinList: Event = {
      id: 'p'.repeat(64),
      kind: 10001,
      pubkey: 'e'.repeat(64),
      created_at: 100,
      content: '',
      tags: [['e', root.id]],
      sig: 'd'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([], [], [], undefined, undefined, null, [
      bookmarkList
    ], [pinList])
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasBookmark).toBe(true)
    expect(engaged[0].hasPin).toBe(true)
  })

  it('matches engagement on nested 30041 addresses', () => {
    const leafAddr = `30041:${PK}:chapter-1`
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr])
    const child = indexEvent('part-1', [leafAddr], '2'.repeat(64))
    const indexByAddress = buildIndexByAddress([root, child])

    const highlight: Event = {
      id: '3'.repeat(64),
      kind: kinds.Highlights,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: 'highlighted text',
      tags: [['a', leafAddr]],
      sig: 'e'.repeat(128)
    }

    const engagement = buildEngagementMapsFromEvents([], [], [highlight])
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)

    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasHighlight).toBe(true)
    expect(engaged[0].hasLabel).toBe(false)
  })

  it('matches labels by root event id', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const indexByAddress = buildIndexByAddress([root])
    const label: Event = {
      id: '4'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [['L', 'license'], ['l', 'MIT', 'license'], ['e', root.id]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [])
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasLabel).toBe(true)
    expect(engaged[0].labelNames).toEqual(['MIT'])
    expect(engaged[0].hasBooklistLabel).toBe(false)
  })

  it('extracts NIP-32 l tag values, not L namespace declarations', () => {
    const rootAddr = `30040:${PK}:jane-eyre-an-autobiography`
    const root = indexEvent('jane-eyre-an-autobiography', [`30041:${PK}:intro`])
    root.tags = [['d', 'jane-eyre-an-autobiography'], ['title', 'Jane Eyre'], ['a', `30041:${PK}:intro`]]
    const indexByAddress = buildIndexByAddress([root])
    const label: Event = {
      id: '5'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [
        ['L', 'ugc'],
        ['l', 'booklist', 'ugc'],
        ['a', rootAddr, 'wss://theforest.nostr1.com']
      ],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [])
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    expect(engaged).toHaveLength(1)
    expect(engaged[0].labelNames).toEqual([])
    expect(engaged[0].hasBooklistLabel).toBe(true)
    expect(engaged[0].hasMyBooklistLabel).toBe(false)
  })

  it('tracks viewer booklist labels separately', () => {
    const rootAddr = `30040:${PK}:book`
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const indexByAddress = buildIndexByAddress([root])
    const viewerPk = 'f'.repeat(64)
    const label: Event = {
      id: '6'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: viewerPk,
      created_at: 50,
      content: '',
      tags: [
        ['L', 'ugc'],
        ['l', 'booklist', 'ugc'],
        ['a', rootAddr]
      ],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [], undefined, undefined, viewerPk)
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    expect(engaged[0].hasBooklistLabel).toBe(true)
    expect(engaged[0].hasMyBooklistLabel).toBe(true)
  })

  it('filterLibraryPublicationsBySearch matches title', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const entries = [
      {
        event: root,
        hasLabel: true,
        labelNames: ['MIT'],
        hasBooklistLabel: false,
        hasMyBooklistLabel: false,
        hasMyComment: false,
        hasMyHighlight: false,
        hasComment: false,
        hasHighlight: false,
        hasBookmark: false,
        hasPin: false,
        engagementCount: 1
      }
    ]
    expect(filterLibraryPublicationsBySearch(entries, 'title book')).toHaveLength(1)
    expect(filterLibraryPublicationsBySearch(entries, 'missing')).toHaveLength(0)
  })

  it('publicationIndexMatchesSearchQuery matches author, source, and section labels', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    root.tags.push(['author', 'Sudraka', 'author'])
    root.tags.push(['source', 'https://www.gutenberg.org/ebooks/21020'])
    root.tags.push(['type', 'book'])
    root.tags.push(['a', `30041:${PK}:intro`, 'wss://relay.example', 'Introduction'])

    expect(publicationIndexMatchesSearchQuery(root, 'sudraka')).toBe(true)
    expect(publicationIndexMatchesSearchQuery(root, 'gutenberg')).toBe(true)
    expect(publicationIndexMatchesSearchQuery(root, 'introduction')).toBe(true)
    expect(publicationIndexMatchesSearchQuery(root, 'missing')).toBe(false)
  })

  it('buildLibraryPublicationRelaySearchFilters uses kind 30040 for d-tag and search', () => {
    expect(publicationQueryDTagVariants('Village Life in China')).toContain('village-life-in-china')

    const filters = buildLibraryPublicationRelaySearchFilters({ query: 'Village Life in China' })
    expect(filters.length).toBeGreaterThan(0)
    expect(filters.every((f) => f.kinds?.length === 1 && f.kinds[0] === ExtendedKind.PUBLICATION)).toBe(
      true
    )

    const dFilter = filters.find((f) => f['#d'])
    expect(dFilter?.['#d']).toContain('village-life-in-china')

    const searchFilter = filters.find((f) => f.search === 'Village Life in China')
    expect(searchFilter?.kinds).toEqual([ExtendedKind.PUBLICATION])
  })

  it('searchLibraryPublications caches results for repeated queries', async () => {
    clearLibrarySearchSessionCache()
    const root = indexEvent('book', [`30041:${PK}:intro`])
    root.tags = [['d', 'book'], ['title', 'Title book'], ['a', `30041:${PK}:intro`]]
    const indexEvents = [root]
    const engagement = buildEngagementMapsFromEvents([], [], [])

    const first = await searchLibraryPublications('title book', { indexEvents, engagement })
    expect(first).toHaveLength(1)

    const peeked = peekLibrarySearchResults('title book', { indexEvents, engagement })
    expect(peeked?.map((e) => e.event.id)).toEqual([root.id])

    const second = await searchLibraryPublications('title book', { indexEvents, engagement })
    expect(second.map((e) => e.event.id)).toEqual([root.id])
  })

  it('searchLibraryPublications cache invalidates when index corpus changes', async () => {
    clearLibrarySearchSessionCache()
    const root = indexEvent('book', [`30041:${PK}:intro`])
    root.tags = [['d', 'book'], ['title', 'Title book'], ['a', `30041:${PK}:intro`]]
    const other = indexEvent('other', [`30041:${PK}:ch`])
    other.tags = [['d', 'other'], ['title', 'Other title'], ['a', `30041:${PK}:ch`]]
    const engagement = buildEngagementMapsFromEvents([], [], [])

    await searchLibraryPublications('title book', { indexEvents: [root, other], engagement })
    expect(peekLibrarySearchResults('title book', { indexEvents: [root, other], engagement })).toHaveLength(1)
    expect(peekLibrarySearchResults('title book', { indexEvents: [root], engagement })).toBeNull()

    const results = await searchLibraryPublications('other title', {
      indexEvents: [root, other],
      engagement
    })
    expect(results).toHaveLength(1)
    expect(results[0].event.id).toBe(other.id)
  })

  it('searchLibraryPublicationIndex searches all indexes and maps nested hits to roots', () => {
    const leafAddr = `30041:${PK}:chapter-1`
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr])
    root.tags = [['d', 'book'], ['title', 'Root Book Title'], ['a', childAddr]]
    const child = indexEvent('part-1', [leafAddr], '2'.repeat(64))
    child.tags = [
      ['d', 'part-1'],
      ['title', 'Part One'],
      ['a', leafAddr, 'wss://relay.example', 'Chapter One']
    ]
    const indexEvents = [root, child]
    const indexByAddress = buildIndexByAddress(indexEvents)

    const byRootTitle = searchLibraryPublicationIndex('root book', indexEvents, indexByAddress)
    expect(byRootTitle.map((ev) => ev.id)).toEqual([root.id])

    const bySection = searchLibraryPublicationIndex('chapter one', indexEvents, indexByAddress)
    expect(bySection.map((ev) => ev.id)).toEqual([root.id])
  })

  it('pickLibraryPublicationEntries falls back to newest roots without engagement', () => {
    const older = indexEvent('old-book', [`30041:${PK}:a`], '1'.repeat(64))
    older.created_at = 10
    const newer = indexEvent('new-book', [`30041:${PK}:b`], '2'.repeat(64))
    newer.created_at = 20
    const indexByAddress = buildIndexByAddress([older, newer])
    const engagement = buildEngagementMapsFromEvents([], [], [])

    const picked = pickLibraryPublicationEntries([older, newer], indexByAddress, engagement)

    expect(picked).toHaveLength(2)
    expect(picked[0].event.id).toBe(newer.id)
    expect(picked.every((e) => e.engagementCount === 0)).toBe(true)
  })

  it('pickLibraryPublicationEntries merges engaged roots with recent feed', () => {
    const engagedRoot = indexEvent('engaged', [`30041:${PK}:a`], '1'.repeat(64))
    engagedRoot.created_at = 5
    const recentRoots = Array.from({ length: 5 }, (_, i) => {
      const ev = indexEvent(`recent-${i}`, [`30041:${PK}:r-${i}`], String(i + 2).padEnd(64, '0').slice(0, 64))
      ev.created_at = 100 + i
      return ev
    })
    const roots = [engagedRoot, ...recentRoots]
    const indexByAddress = buildIndexByAddress(roots)
    const label: Event = {
      id: '4'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [['L', 'ugc'], ['l', 'booklist', 'ugc'], ['e', engagedRoot.id]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [])

    const picked = pickLibraryPublicationEntries(roots, indexByAddress, engagement)

    expect(picked.length).toBeGreaterThan(1)
    expect(picked.some((e) => e.event.id === engagedRoot.id && e.hasBooklistLabel)).toBe(true)
    expect(picked.some((e) => e.event.id === recentRoots[4].id)).toBe(true)
  })

  it('buildRecentPublicationEntries caps at limit', () => {
    const roots = Array.from({ length: 12 }, (_, i) => {
      const ev = indexEvent(`book-${i}`, [`30041:${PK}:ch-${i}`], String(i).padEnd(64, '0').slice(0, 64))
      ev.created_at = i
      return ev
    })
    const indexByAddress = buildIndexByAddress(roots)
    const engagement = buildEngagementMapsFromEvents([], [], [])
    expect(buildRecentPublicationEntries(roots, indexByAddress, engagement, 10)).toHaveLength(10)
    expect(buildRecentPublicationEntries(roots, indexByAddress, engagement, 10)[0].event.created_at).toBe(11)
  })

  it('libraryDefaultFeedSlice pages through the feed in chunks of LIBRARY_PAGE_SIZE', () => {
    const roots = Array.from({ length: 250 }, (_, i) => {
      const ev = indexEvent(`book-${i}`, [`30041:${PK}:ch-${i}`], `${String(i).padStart(64, '0')}`)
      ev.created_at = i
      return ev
    })
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const topLevelCount = roots.length

    const page0 = libraryDefaultFeedSlice(roots, engagement, 0)
    expect(page0.entries).toHaveLength(LIBRARY_PAGE_SIZE)
    expect(page0.totalCount).toBe(topLevelCount)
    expect(page0.hasMore).toBe(topLevelCount > LIBRARY_PAGE_SIZE)

    const page1 = libraryDefaultFeedSlice(roots, engagement, 1)
    expect(page1.entries).toHaveLength(Math.min(LIBRARY_PAGE_SIZE * 2, topLevelCount))
    expect(page1.hasMore).toBe(topLevelCount > LIBRARY_PAGE_SIZE * 2)

    const lastPageIndex = Math.ceil(topLevelCount / LIBRARY_PAGE_SIZE) - 1
    const lastPage = libraryDefaultFeedSlice(roots, engagement, lastPageIndex)
    expect(lastPage.entries).toHaveLength(topLevelCount)
    expect(lastPage.hasMore).toBe(false)
  })

  it('computeLibraryFeedRootOrder keeps engaged roots before recent ones', () => {
    const engagedRoot = indexEvent('engaged', [`30041:${PK}:a`], '1'.repeat(64))
    engagedRoot.created_at = 1
    const recentRoot = indexEvent('recent', [`30041:${PK}:b`], '2'.repeat(64))
    recentRoot.created_at = 100
    const indexByAddress = buildIndexByAddress([engagedRoot, recentRoot])
    const label: Event = {
      id: '4'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [['L', 'ugc'], ['l', 'booklist', 'ugc'], ['e', engagedRoot.id]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [])
    const ordered = computeLibraryFeedRootOrder([engagedRoot, recentRoot], indexByAddress, engagement)
    expect(ordered.map((e) => e.id)).toEqual([engagedRoot.id, recentRoot.id])
  })

  it('filterLibraryPublicationsByUser includes authored, booklist, bookmarked, and commented', () => {
    const viewerPk = 'f'.repeat(64)
    const authored = indexEvent('mine', [`30041:${PK}:ch`], '1'.repeat(64))
    authored.pubkey = viewerPk
    const booklisted = indexEvent('booklisted', [`30041:${PK}:ch2`], '2'.repeat(64))
    const commented = indexEvent('commented', [`30041:${PK}:ch3`], '3'.repeat(64))
    const unrelated = indexEvent('other', [`30041:${PK}:ch4`], '4'.repeat(64))
    const entries = [
      {
        event: authored,
        hasLabel: false,
        labelNames: [],
        hasBooklistLabel: false,
        hasMyBooklistLabel: false,
        hasMyComment: false,
        hasMyHighlight: false,
        hasComment: false,
        hasHighlight: false,
        hasBookmark: false,
        hasPin: false,
        engagementCount: 0
      },
      {
        event: booklisted,
        hasLabel: false,
        labelNames: [],
        hasBooklistLabel: true,
        hasMyBooklistLabel: true,
        hasMyComment: false,
        hasMyHighlight: false,
        hasComment: false,
        hasHighlight: false,
        hasBookmark: false,
        hasPin: false,
        engagementCount: 0
      },
      {
        event: commented,
        hasLabel: false,
        labelNames: [],
        hasBooklistLabel: false,
        hasMyBooklistLabel: false,
        hasMyComment: true,
        hasMyHighlight: false,
        hasComment: true,
        hasHighlight: false,
        hasBookmark: false,
        hasPin: false,
        engagementCount: 1
      },
      {
        event: unrelated,
        hasLabel: false,
        labelNames: [],
        hasBooklistLabel: false,
        hasMyBooklistLabel: false,
        hasMyComment: false,
        hasMyHighlight: false,
        hasComment: false,
        hasHighlight: false,
        hasBookmark: false,
        hasPin: false,
        engagementCount: 0
      }
    ]
    const bookmarkList: Event = {
      id: 'b'.repeat(64),
      kind: kinds.BookmarkList,
      pubkey: viewerPk,
      created_at: 100,
      content: '',
      tags: [['a', `30040:${PK}:other`]],
      sig: 'd'.repeat(128)
    }
    unrelated.tags.push(['d', 'other'])

    const filtered = filterLibraryPublicationsByUser(entries, viewerPk, {
      bookmarkListEvent: bookmarkList
    })
    expect(filtered.map((e) => e.event.id).sort()).toEqual(
      [authored.id, booklisted.id, commented.id, unrelated.id].sort()
    )
  })

  it('searchLibraryPublications keeps my booklist flags for booklist-only publications', async () => {
    clearLibrarySearchSessionCache()
    const viewerPk = 'f'.repeat(64)
    const rootAddr = `30040:${PK}:jane-eyre`
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`], '9'.repeat(64))
    root.tags = [['d', 'jane-eyre'], ['title', 'Jane Eyre'], ['a', `30041:${PK}:intro`]]
    const label: Event = {
      id: '7'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: viewerPk,
      created_at: 50,
      content: '',
      tags: [['L', 'ugc'], ['l', 'booklist', 'ugc'], ['a', rootAddr]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [], undefined, undefined, viewerPk)
    const results = await searchLibraryPublications('jane eyre', { indexEvents: [root], engagement })
    expect(results).toHaveLength(1)
    expect(results[0].hasMyBooklistLabel).toBe(true)
    expect(filterLibraryPublicationsByUser(results, viewerPk)).toHaveLength(1)
  })

  it('libraryPublicationEntriesForUserFromIndex builds only matching roots', () => {
    const viewerPk = 'f'.repeat(64)
    const mine = indexEvent('mine', [`30041:${PK}:a`], '1'.repeat(64))
    mine.pubkey = viewerPk
    const other = indexEvent('other', [`30041:${PK}:b`], '2'.repeat(64))
    const indexEvents = [mine, other]
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const entries = libraryPublicationEntriesForUserFromIndex(indexEvents, engagement, viewerPk, {
      myBooklistAddresses: new Set()
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].event.id).toBe(mine.id)
  })

  it('publicationRootBelongsToUser matches booklist address without building entries', () => {
    const viewerPk = 'f'.repeat(64)
    const rootAddr = `30040:${PK}:jane-eyre`
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`], '9'.repeat(64))
    const indexByAddress = buildIndexByAddress([root])
    const engagement = buildEngagementMapsFromEvents([], [], [])
    expect(
      publicationRootBelongsToUser(root, indexByAddress, engagement, viewerPk, {
        myBooklistAddresses: new Set([rootAddr])
      })
    ).toBe(true)
  })

  it('filterLibraryPublicationsByUser matches myBooklistAddresses without engagement flags', () => {
    const viewerPk = 'f'.repeat(64)
    const rootAddr = `30040:${PK}:jane-eyre`
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`], '9'.repeat(64))
    const entry = {
      event: root,
      hasLabel: false,
      labelNames: [],
      hasBooklistLabel: false,
      hasMyBooklistLabel: false,
      hasMyComment: false,
      hasMyHighlight: false,
      hasComment: false,
      hasHighlight: false,
      hasBookmark: false,
      hasPin: false,
      engagementCount: 0
    }
    const filtered = filterLibraryPublicationsByUser([entry], viewerPk, {
      myBooklistAddresses: new Set([rootAddr])
    })
    expect(filtered).toHaveLength(1)
  })
})
