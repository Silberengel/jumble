import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  applyCreatedAtBoundsToFilter,
  buildDocumentRelayStructuredTagFilters,
  buildEngagementMapsFromEvents,
  buildLibraryPublicationEntry,
  buildDocumentRelayPublicationFilters,
  buildLibraryPublicationRelaySearchFilters,
  buildLibraryPublicationRelaySearchFiltersForAxis,
  buildRecentPublicationEntries,
  clearLibrarySearchSessionCache,
  computeLibraryFeedRootOrder,
  filterPublicationContentEventsForQuery,
  filterEngagedPublications,
  filterEventsForPublicationRelaySearchAxis,
  filterLibraryEntriesByCreatedAt,
  filterLibraryPublicationsBySearch,
  filterLibraryPublicationsByUser,
  libraryDefaultFeedSlice,
  libraryPublicationEntriesForUserFromIndex,
  LIBRARY_PAGE_SIZE,
  localDateInputToUnixEnd,
  localDateInputToUnixStart,
  pickLibraryPublicationEntries,
  publicationIndexMatchesLanguageQuery,
  publicationMetadataTagMatchesQuery,
  publicationRootBelongsToUser,
  peekLibrarySearchResults,
  publicationIndexMatchesSearchQuery,
  dTagSlugContainsHyphenNeedle,
  publicationQueryDTagVariants,
  publicationAxisDTagFilterValues,
  libraryPublicationRootsForContentEvents,
  rankPublicationContentEventsForQuery,
  sortLibrarySearchPublications,
  sortLibrarySearchPublicationsByLabelRank,
  filterAndSortLibraryRecommendedPublications,
  getPublicationLabelRankTier,
  LIBRARY_GC_PUBLISHING_PUBKEY,
  shouldSearchPublicationContentOnRelays,
  searchLibraryPublicationIndex,
  searchLibraryPublications,
  structuredQueryFilledFields,
  unixSecondsToLocalDateInput
} from '@/lib/library-publication-index'
import { buildIndexByAddress } from '@/lib/publication-index'
import type { Event, Filter } from 'nostr-tools'
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
    const child = indexEvent('part-1', [leafAddr])
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

  it('buildLibraryPublicationRelaySearchFilters splits kind 30040 into d-tag, title, and author without NIP-50', () => {
    expect(publicationQueryDTagVariants('Village Life in China')).toContain('village-life-in-china')

    const dTagFilters = buildLibraryPublicationRelaySearchFiltersForAxis('d-tag', {
      query: 'Village Life in China'
    })
    expect(dTagFilters.some((f) => f['#d']?.includes('village-life-in-china'))).toBe(true)
    expect(dTagFilters.every((f) => f.kinds?.includes(ExtendedKind.PUBLICATION))).toBe(true)
    expect(dTagFilters.every((f) => f.search == null)).toBe(true)

    const titleFilters = buildLibraryPublicationRelaySearchFiltersForAxis('title', {
      query: 'Village Life in China'
    })
    expect(titleFilters.some((f) => (f as Filter & { '#T'?: string[] })['#T']?.length)).toBe(true)
    expect(titleFilters.every((f) => !(f as Filter & { '#title'?: string[] })['#title'])).toBe(true)
    expect(titleFilters.every((f) => f.search == null)).toBe(true)

    const docDTag = buildDocumentRelayPublicationFilters('d-tag', 'redacted-science')
    expect(docDTag[0]?.['#d']).toContain('redacted-science')
    expect(docDTag.every((f) => f.search == null)).toBe(true)

    const docDTagSingle = buildDocumentRelayPublicationFilters('d-tag', 'faust')
    expect(docDTagSingle.some((f) => f['#d']?.includes('faust'))).toBe(true)
    expect(docDTagSingle.every((f) => f.search == null)).toBe(true)

    const docTitle = buildDocumentRelayPublicationFilters('title', 'Redacted Science')
    expect(docTitle.some((f) => (f as Filter & { '#T'?: string[] })['#T']?.includes('redacted-science'))).toBe(
      true
    )
    expect(docTitle.some((f) => (f as Filter & { '#T'?: string[] })['#T']?.includes('Redacted Science'))).toBe(
      false
    )
    expect(docTitle.every((f) => !f['#d']?.length)).toBe(true)
    expect(docTitle.every((f) => !(f as Filter & { '#title'?: string[] })['#title'])).toBe(true)
    expect(docTitle.every((f) => f.search == null)).toBe(true)

    const docAuthor = buildDocumentRelayPublicationFilters('author', 'Jane Austen')
    expect(docAuthor.some((f) => (f as Filter & { '#N'?: string[] })['#N']?.includes('jane-austen'))).toBe(
      true
    )
    expect(docAuthor.some((f) => (f as Filter & { '#N'?: string[] })['#N']?.includes('Jane Austen'))).toBe(
      false
    )
    expect(docAuthor.every((f) => !f['#d']?.length)).toBe(true)
    expect(docAuthor.every((f) => !(f as Filter & { '#author'?: string[] })['#author'])).toBe(true)
    expect(docAuthor.every((f) => f.search == null)).toBe(true)

    const authorFilters = buildLibraryPublicationRelaySearchFiltersForAxis('author', {
      query: 'Jane Austen'
    })
    expect(authorFilters.some((f) => (f as Filter & { '#N'?: string[] })['#N']?.length)).toBe(true)
    expect(authorFilters.every((f) => !f['#d']?.length)).toBe(true)
    expect(authorFilters.every((f) => !(f as Filter & { '#author'?: string[] })['#author'])).toBe(true)

    const titleFiltersWithD = buildLibraryPublicationRelaySearchFiltersForAxis('title', {
      query: 'Jane Eyre'
    })
    expect(titleFiltersWithD.every((f) => !f['#d']?.length)).toBe(true)
    expect(titleFiltersWithD.some((f) => (f as Filter & { '#T'?: string[] })['#T']?.length)).toBe(true)

    const merged = buildLibraryPublicationRelaySearchFilters({ query: 'Village Life in China' })
    // d-tag axis still emits exact `#d` for explicit slug queries; title/author do not.
    expect(merged.some((f) => f['#d']?.includes('village-life-in-china'))).toBe(true)
    expect(merged.every((f) => f.search == null)).toBe(true)
    expect(merged.every((f) => !(f as Filter & { '#title'?: string[] })['#title'])).toBe(true)
    expect(merged.every((f) => !(f as Filter & { '#author'?: string[] })['#author'])).toBe(true)
    // Mercury / NIP-01: only single-letter `#` filter keys
    expect(
      merged.every((f) =>
        Object.keys(f).every((k) => !k.startsWith('#') || /^#[a-zA-Z]$/.test(k))
      )
    ).toBe(true)
  })

  it('filterEventsForPublicationRelaySearchAxis keeps axis-specific kind-30040 matches', () => {
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`])
    root.tags = [
      ['d', 'jane-eyre'],
      ['title', 'Jane Eyre'],
      ['author', 'Charlotte Brontë'],
      ['a', `30041:${PK}:intro`]
    ]

    const byDTag = filterEventsForPublicationRelaySearchAxis([root], 'd-tag', 'jane-eyre')
    expect(byDTag).toHaveLength(1)

    const byTitle = filterEventsForPublicationRelaySearchAxis([root], 'title', 'jane eyre')
    expect(byTitle).toHaveLength(1)

    const byAuthor = filterEventsForPublicationRelaySearchAxis([root], 'author', 'charlotte brontë')
    expect(byAuthor).toHaveLength(1)

    expect(filterEventsForPublicationRelaySearchAxis([root], 'title', 'charlotte')).toHaveLength(0)
    expect(filterEventsForPublicationRelaySearchAxis([root], 'author', 'charlotte')).toHaveLength(1)
    expect(publicationMetadataTagMatchesQuery(root, 'title', 'Jane Eyre')).toBe(true)
    expect(publicationMetadataTagMatchesQuery(root, 'author', 'Brontë')).toBe(true)
  })

  it('title and author axes match when only the d-tag embeds the slug', () => {
    const root = indexEvent('pg-only', [`30041:${PK}:intro`])
    root.tags = [
      ['d', 'pg12345-jane-eyre-charlotte-bronte'],
      ['T', 'historical-thinking'], // unrelated title slug
      ['N', 'other-author'],
      ['a', `30041:${PK}:intro`]
    ]

    expect(filterEventsForPublicationRelaySearchAxis([root], 'title', 'jane eyre')).toHaveLength(1)
    expect(filterEventsForPublicationRelaySearchAxis([root], 'author', 'charlotte bronte')).toHaveLength(
      1
    )
    expect(publicationAxisDTagFilterValues('title', 'Jane Eyre')).toContain('jane-eyre')
    expect(publicationAxisDTagFilterValues('author', 'Charlotte Bronte')).toContain(
      'charlotte-bronte'
    )
  })

  it('matches Gutenberg-style d-tags when the query is an embedded segment', () => {
    const faustLegend: Event = {
      id: '280ced75267bb121789f5b45cd6a33d19e81fa89377c92831116c0bbacdeb2cf',
      kind: ExtendedKind.PUBLICATION,
      pubkey: '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690',
      created_at: 1780737217,
      content: '',
      tags: [
        ['d', 'pg25732-the-faust-legend-and-goethes-faust'],
        ['title', "The Faust-Legend and Goethe's 'Faust'"],
        ['author', 'H. B. Cotterill', 'author'],
        ['a', `30041:3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690:pg25732-chapter-1-preface`]
      ],
      sig: 'a6d5f170d2fa3d1100142af3ac4e8898a53468ef0c07a285781b76cc893cca97bbb16ec1d03e6fcba16952a05f29d42dd9de73662dc9fe85d0c8d652fd08723a'
    }

    expect(publicationMetadataTagMatchesQuery(faustLegend, 'd', 'faust')).toBe(true)
    expect(filterEventsForPublicationRelaySearchAxis([faustLegend], 'd-tag', 'faust')).toHaveLength(1)
    expect(publicationIndexMatchesSearchQuery(faustLegend, 'faust')).toBe(true)
  })

  it('matches long Alexandria-style d-tags by prefix and title substring', () => {
    const janeEyre: Event = {
      id: 'b74c3b256e343cb282e5987b9ec45ef84d5063604db41a56d8a49b3357889178',
      kind: ExtendedKind.PUBLICATION,
      pubkey: 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1',
      created_at: 1742502230,
      content: '',
      tags: [
        ['d', 'jane-eyre-an-autobiography-by-charlotte-brontë-v-3rd-edition'],
        ['title', 'Jane Eyre, an Autobiography'],
        ['author', 'Charlotte Brontë'],
        ['a', '30041:fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1:jane-eyre-an-autobiography-preface-1-by-charlotte-brontë-v-3rd-edition']
      ],
      sig: '0f58db8ac9a9daba0c2a2c5096b82ea374cefded39bea751f54069ec2cea1d983a361185db6a8152764e084eb83f99bd47b5f7ffcc5e8e6efe79e16657cbe7d2'
    }

    expect(publicationMetadataTagMatchesQuery(janeEyre, 'title', 'jane eyre')).toBe(true)
    expect(publicationMetadataTagMatchesQuery(janeEyre, 'd', 'jane-eyre')).toBe(true)
    expect(publicationIndexMatchesSearchQuery(janeEyre, 'jane eyre')).toBe(true)
    expect(filterEventsForPublicationRelaySearchAxis([janeEyre], 'd-tag', 'jane-eyre')).toHaveLength(1)
    expect(filterEventsForPublicationRelaySearchAxis([janeEyre], 'title', 'jane eyre')).toHaveLength(1)

    const condensed: Event = {
      ...janeEyre,
      id: 'c'.repeat(64),
      tags: [
        ['d', 'an-autobiography-jane-eyre-condensed'],
        ['title', 'An Autobiography of Jane Eyre, condensed'],
        ['author', 'Charlotte Brontë'],
        ['a', '30041:fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1:chapter-1']
      ]
    }

    expect(dTagSlugContainsHyphenNeedle('an-autobiography-jane-eyre-condensed', 'jane-eyre')).toBe(true)
    expect(publicationMetadataTagMatchesQuery(condensed, 'd', 'jane-eyre')).toBe(true)
    expect(publicationMetadataTagMatchesQuery(condensed, 'title', 'jane eyre')).toBe(true)
    expect(filterEventsForPublicationRelaySearchAxis([condensed], 'd-tag', 'jane eyre')).toHaveLength(1)
    expect(filterEventsForPublicationRelaySearchAxis([condensed], 'title', 'jane eyre')).toHaveLength(1)
    expect(publicationIndexMatchesSearchQuery(condensed, 'jane eyre')).toBe(true)
  })

  it('searchLibraryPublications respects author axis and keeps separate cache keys', async () => {
    clearLibrarySearchSessionCache()
    const about = indexEvent('about-aristotle', [`30041:${PK}:intro`])
    about.tags = [
      ['d', 'about-aristotle'],
      ['title', 'Aristotle: A Very Short Introduction'],
      ['author', 'John Smith'],
      ['a', `30041:${PK}:intro`]
    ]
    const fromAuthor = indexEvent('nicomachean-ethics', [`30041:${PK}:ch`])
    fromAuthor.tags = [
      ['d', 'nicomachean-ethics'],
      ['title', 'Nicomachean Ethics'],
      ['author', 'Aristotle'],
      ['a', `30041:${PK}:ch`]
    ]
    const indexEvents = [about, fromAuthor]
    const engagement = buildEngagementMapsFromEvents([], [], [])

    const broad = await searchLibraryPublications('aristotle', { indexEvents, engagement })
    expect(broad.map((e) => e.event.id).sort()).toEqual([about.id, fromAuthor.id].sort())

    const byAuthor = await searchLibraryPublications('aristotle', { indexEvents, engagement }, 'author')
    // Author axis also matches `d` (e.g. `about-aristotle`), not only `#N` / author tags.
    expect(byAuthor.map((e) => e.event.id).sort()).toEqual([about.id, fromAuthor.id].sort())

    expect(peekLibrarySearchResults('aristotle', { indexEvents, engagement }, 'author')).toHaveLength(2)
    expect(peekLibrarySearchResults('aristotle', { indexEvents, engagement })).toHaveLength(2)
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
    const child = indexEvent('part-1', [leafAddr])
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
    const older = indexEvent('old-book', [`30041:${PK}:a`])
    older.created_at = 10
    const newer = indexEvent('new-book', [`30041:${PK}:b`])
    newer.created_at = 20
    const indexByAddress = buildIndexByAddress([older, newer])
    const engagement = buildEngagementMapsFromEvents([], [], [])

    const picked = pickLibraryPublicationEntries([older, newer], indexByAddress, engagement)

    expect(picked).toHaveLength(2)
    expect(picked[0].event.id).toBe(newer.id)
    expect(picked.every((e) => e.engagementCount === 0)).toBe(true)
  })

  it('pickLibraryPublicationEntries orders by newest created_at', () => {
    const older = indexEvent('older', [`30041:${PK}:a`])
    older.created_at = 5
    const newer = indexEvent('newer', [`30041:${PK}:b`])
    newer.created_at = 100
    const roots = [older, newer]
    const indexByAddress = buildIndexByAddress(roots)
    const engagement = buildEngagementMapsFromEvents([], [], [])

    const picked = pickLibraryPublicationEntries(roots, indexByAddress, engagement)

    expect(picked.map((e) => e.event.id)).toEqual([newer.id, older.id])
  })

  it('buildRecentPublicationEntries caps at limit', () => {
    const roots = Array.from({ length: 12 }, (_, i) => {
      const ev = indexEvent(`book-${i}`, [`30041:${PK}:ch-${i}`])
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
      const ev = indexEvent(`book-${i}`, [`30041:${PK}:ch-${i}`])
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

  it('computeLibraryFeedRootOrder sorts by newest created_at', () => {
    const older = indexEvent('older', [`30041:${PK}:a`])
    older.created_at = 1
    const newer = indexEvent('newer', [`30041:${PK}:b`])
    newer.created_at = 100
    const indexByAddress = buildIndexByAddress([older, newer])
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const ordered = computeLibraryFeedRootOrder([older, newer], indexByAddress, engagement)
    expect(ordered.map((e) => e.id)).toEqual([newer.id, older.id])
  })

  it('filterLibraryPublicationsByUser includes authored, booklist, bookmarked, and commented', () => {
    const viewerPk = 'f'.repeat(64)
    const authored = indexEvent('mine', [`30041:${PK}:ch`])
    authored.pubkey = viewerPk
    const booklisted = indexEvent('booklisted', [`30041:${PK}:ch2`])
    const commented = indexEvent('commented', [`30041:${PK}:ch3`])
    const unrelated = indexEvent('other', [`30041:${PK}:ch4`])
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
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`])
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
    const mine = indexEvent('mine', [`30041:${PK}:a`])
    mine.pubkey = viewerPk
    const other = indexEvent('other', [`30041:${PK}:b`])
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
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`])
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
    const root = indexEvent('jane-eyre', [`30041:${PK}:intro`])
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

  it('publicationIndexMatchesSearchQuery skips kind-30040 content field', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    root.content = 'only in root content'
    expect(publicationIndexMatchesSearchQuery(root, 'only in root content')).toBe(false)
    expect(publicationIndexMatchesSearchQuery(root, 'Title book')).toBe(true)
  })

  it('libraryPublicationRootsForContentEvents maps section body text to publication roots', () => {
    const quote = 'said Evangelist, pointing with his finger over a very wide field'
    const contentD = 'pilgrims-progress-ch-1'
    const contentAddr = `30041:${PK}:${contentD}`
    const root = indexEvent('pilgrims-progress', [contentAddr])
    root.tags = [
      ['d', 'pilgrims-progress'],
      ['title', "Pilgrim's Progress"],
      ['a', contentAddr]
    ]
    const section = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content: `Then ${quote}, that I saw.`,
        tags: [['d', contentD], ['title', 'Chapter 1']]
      },
      sk
    )
    const indexEvents = [root]
    const indexByAddress = buildIndexByAddress(indexEvents)
    expect(
      libraryPublicationRootsForContentEvents(quote, [section], indexEvents, indexByAddress)
    ).toEqual([root])
    expect(
      libraryPublicationRootsForContentEvents('Chapter 1', [section], indexEvents, indexByAddress)
    ).toEqual([root])
  })

  it('rankPublicationContentEventsForQuery orders phrase matches first', () => {
    const quote = 'Since our mother died, we have had no happiness'
    const contentD = 'pg52521-chapter-5-little-brother-and-little-sister'
    const grimmsSection = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content:
          'Little brother took his little sister by the hand and said, “Since our\nmother died, we have had no happiness; our stepmother beats us every day',
        tags: [['d', contentD], ['title', 'Little Brother and Little Sister']]
      },
      sk
    )
    const weakSection = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 50,
        content: 'Our mother once spoke of happiness in general terms.',
        tags: [['d', 'other-chapter'], ['title', 'Other']]
      },
      sk
    )
    const ranked = rankPublicationContentEventsForQuery([weakSection, grimmsSection], quote, 5)
    expect(ranked[0]?.id).toBe(grimmsSection.id)
  })

  it('libraryPublicationRootsForContentEvents returns empty until parent index is available', () => {
    const quote = 'orphan section quote'
    const contentD = 'orphan-chapter'
    const contentAddr = `30041:${PK}:${contentD}`
    const section = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content: quote,
        tags: [['d', contentD], ['title', 'Orphan Chapter']]
      },
      sk
    )
    expect(
      libraryPublicationRootsForContentEvents(quote, [section], [], new Map())
    ).toEqual([])

    const root = indexEvent('orphan-book', [contentAddr])
    const indexEvents = [root]
    expect(
      libraryPublicationRootsForContentEvents(
        quote,
        [section],
        indexEvents,
        buildIndexByAddress(indexEvents)
      )
    ).toEqual([root])
  })

  it('libraryPublicationRootsForContentEvents resolves nested indexes after parent merge', () => {
    const quote = 'nested section quote'
    const contentD = 'nested-section'
    const contentAddr = `30041:${PK}:${contentD}`
    const partAddr = `30040:${PK}:nested-part`
    const section = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content: quote,
        tags: [['d', contentD], ['title', 'Nested Section']]
      },
      sk
    )
    const part = indexEvent('nested-part', [contentAddr])
    const book = indexEvent('nested-book', [partAddr])
    const indexEvents = [book, part]
    const indexByAddress = buildIndexByAddress(indexEvents)
    expect(
      libraryPublicationRootsForContentEvents(quote, [section], indexEvents, indexByAddress)
    ).toEqual([book])
  })

  it('sortLibrarySearchPublications ranks exact phrase content matches first', () => {
    const quote = 'I urged, when he halted once more.'
    const exactRoot = indexEvent('jane-eyre', [`30041:${PK}:ch`])
    exactRoot.created_at = 100
    const weakRoot = indexEvent('other-book', [`30041:${PK}:other`])
    weakRoot.created_at = 999
    const indexByAddress = buildIndexByAddress([exactRoot, weakRoot])
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const entries = sortLibrarySearchPublications(
      [
        {
          ...buildLibraryPublicationEntry(weakRoot, indexByAddress, engagement),
          contentSearchMatch: {
            sectionAddress: `30041:${PK}:other`,
            highlightQuery: quote,
            contentEvent: weakRoot,
            matchScore: 5
          }
        },
        {
          ...buildLibraryPublicationEntry(exactRoot, indexByAddress, engagement),
          contentSearchMatch: {
            sectionAddress: `30041:${PK}:ch`,
            highlightQuery: quote,
            contentEvent: exactRoot,
            matchScore: 10_000 + quote.length
          }
        }
      ],
      quote
    )
    expect(entries[0].event.id).toBe(exactRoot.id)
  })

  it('sortLibrarySearchPublications ranks exact T/N above newer content-only fuzzy hits', () => {
    const pride = indexEvent('pride-and-prejudice', [])
    pride.tags.push(['T', 'pride-and-prejudice'], ['N', 'jane-austen'], ['title', 'Pride and Prejudice'])
    pride.created_at = 100
    const unrelated = indexEvent('other-pg', [])
    unrelated.tags.push(['T', 'village-life'], ['N', 'other-author'])
    unrelated.created_at = 999
    const indexByAddress = buildIndexByAddress([pride, unrelated])
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const entries = sortLibrarySearchPublications(
      [
        {
          ...buildLibraryPublicationEntry(unrelated, indexByAddress, engagement),
          contentSearchMatch: {
            sectionAddress: `30041:${PK}:noise`,
            highlightQuery: 'Jane Austen',
            contentEvent: unrelated,
            matchScore: 220
          }
        },
        buildLibraryPublicationEntry(pride, indexByAddress, engagement)
      ],
      'Jane Austen'
    )
    expect(entries[0].event.id).toBe(pride.id)
  })

  it('sortLibrarySearchPublicationsByLabelRank prioritizes viewer, follow, then GC Publishing labels', () => {
    const viewerPk = 'a'.repeat(64)
    const followPk = 'b'.repeat(64)
    const gcPk = LIBRARY_GC_PUBLISHING_PUBKEY
    const otherPk = 'c'.repeat(64)

    const makeRoot = (id: string) => {
      const root = indexEvent(id, [`30041:${PK}:ch-${id}`])
      root.created_at = 100
      return root
    }

    const gcRoot = makeRoot('gc-book')
    const followRoot = makeRoot('follow-book')
    const viewerRoot = makeRoot('viewer-book')
    const otherRoot = makeRoot('other-book')
    const indexEvents = [gcRoot, followRoot, viewerRoot, otherRoot]
    const indexByAddress = buildIndexByAddress(indexEvents)

    const labelFor = (pubkey: string, root: Event): Event => ({
      id: `${pubkey.slice(0, 8)}${root.id.slice(8)}`,
      kind: ExtendedKind.LABEL,
      pubkey,
      created_at: 50,
      content: '',
      tags: [['L', 'license'], ['l', 'MIT', 'license'], ['e', root.id]],
      sig: 'e'.repeat(128)
    })

    const engagement = buildEngagementMapsFromEvents(
      [
        labelFor(otherPk, otherRoot),
        labelFor(gcPk, gcRoot),
        labelFor(followPk, followRoot),
        labelFor(viewerPk, viewerRoot)
      ],
      [],
      []
    )

    const ctx = { viewerPubkey: viewerPk, followPubkeys: new Set([followPk]) }
    const entries = [
      buildLibraryPublicationEntry(otherRoot, indexByAddress, engagement),
      buildLibraryPublicationEntry(gcRoot, indexByAddress, engagement),
      buildLibraryPublicationEntry(followRoot, indexByAddress, engagement),
      buildLibraryPublicationEntry(viewerRoot, indexByAddress, engagement)
    ]

    expect(getPublicationLabelRankTier(entries[0], indexByAddress, engagement, ctx)).toBe(3)
    expect(getPublicationLabelRankTier(entries[1], indexByAddress, engagement, ctx)).toBe(2)
    expect(getPublicationLabelRankTier(entries[2], indexByAddress, engagement, ctx)).toBe(1)
    expect(getPublicationLabelRankTier(entries[3], indexByAddress, engagement, ctx)).toBe(0)

    const ranked = sortLibrarySearchPublicationsByLabelRank(entries, indexEvents, engagement, ctx)
    expect(ranked.map((e) => e.event.id)).toEqual([
      viewerRoot.id,
      followRoot.id,
      gcRoot.id,
      otherRoot.id
    ])
  })

  it('filterAndSortLibraryRecommendedPublications keeps follow and GC labels only', () => {
    const followPk = 'b'.repeat(64)
    const gcPk = LIBRARY_GC_PUBLISHING_PUBKEY
    const followRoot = indexEvent('follow-book', [`30041:${PK}:follow`])
    const gcRoot = indexEvent('gc-book', [`30041:${PK}:gc`])
    const plainRoot = indexEvent('plain-book', [`30041:${PK}:plain`])
    const indexEvents = [followRoot, gcRoot, plainRoot]
    const indexByAddress = buildIndexByAddress(indexEvents)

    const labelFor = (pubkey: string, root: Event): Event => ({
      id: `${pubkey.slice(0, 8)}${root.id.slice(8)}`,
      kind: ExtendedKind.LABEL,
      pubkey,
      created_at: 50,
      content: '',
      tags: [['L', 'license'], ['l', 'MIT', 'license'], ['e', root.id]],
      sig: 'e'.repeat(128)
    })

    const engagement = buildEngagementMapsFromEvents(
      [labelFor(followPk, followRoot), labelFor(gcPk, gcRoot)],
      [],
      []
    )
    const entries = indexEvents.map((root) => buildLibraryPublicationEntry(root, indexByAddress, engagement))
    const filtered = filterAndSortLibraryRecommendedPublications(entries, indexEvents, engagement, {
      followPubkeys: new Set([followPk])
    })
    expect(filtered.map((e) => e.event.id)).toEqual([followRoot.id, gcRoot.id])
    expect(filtered[0].labelCuratorPubkeys).toEqual([followPk])
    expect(filtered[1].labelCuratorPubkeys).toEqual([gcPk])
  })

  it('shouldSearchPublicationContentOnRelays is true for quote-like all-fields queries only', () => {
    expect(shouldSearchPublicationContentOnRelays('"I urged, when he halted once more."', null)).toBe(true)
    expect(
      shouldSearchPublicationContentOnRelays('stronger, but right is the necessity of the weak', null)
    ).toBe(true)
    expect(shouldSearchPublicationContentOnRelays('jane eyre', null)).toBe(false)
    expect(shouldSearchPublicationContentOnRelays('short', null)).toBe(false)
    expect(shouldSearchPublicationContentOnRelays('"quote"', 'title')).toBe(false)
  })

  it('filterPublicationContentEventsForQuery keeps phrase hits and drops scattered-word-only hits for quotes', () => {
    const quote = '"I urged, when he halted once more."'
    const exact = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content: `She said: I urged, when he halted once more. Then paused.`,
        tags: [['d', 'ch-1']]
      },
      sk
    )
    const weak = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION_CONTENT,
        created_at: 100,
        content: 'They urged him onward.',
        tags: [['d', 'ch-2']]
      },
      sk
    )
    expect(filterPublicationContentEventsForQuery([exact, weak], quote)).toEqual([exact])
  })

  it('structuredQueryFilledFields follows bibliographic UI order and ignores date bounds', () => {
    const fields = structuredQueryFilledFields({
      fullText: 'passage',
      dTag: 'divine-comedy',
      identifier: 'isbn:123',
      language: 'en',
      subject: 'poetry',
      author: 'dante',
      title: 'inferno',
      since: 100,
      until: 200
    })
    expect(fields.map((f) => f.field)).toEqual([
      'title',
      'author',
      'subject',
      'language',
      'identifier',
      'dTag',
      'fullText'
    ])
  })

  it('filterLibraryEntriesByCreatedAt keeps entries inside since/until', () => {
    const older = indexEvent('older', [], { created_at: 10 })
    const mid = indexEvent('mid', [], { created_at: 50 })
    const newer = indexEvent('newer', [], { created_at: 100 })
    const indexByAddress = buildIndexByAddress([older, mid, newer])
    const engagement = buildEngagementMapsFromEvents([], [], [])
    const entries = [older, mid, newer].map((event) =>
      buildLibraryPublicationEntry(event, indexByAddress, engagement)
    )

    expect(filterLibraryEntriesByCreatedAt(entries).map((e) => e.event.id)).toEqual([
      older.id,
      mid.id,
      newer.id
    ])
    expect(filterLibraryEntriesByCreatedAt(entries, 40, 80).map((e) => e.event.id)).toEqual([
      mid.id
    ])
    expect(filterLibraryEntriesByCreatedAt(entries, 50).map((e) => e.event.id)).toEqual([
      mid.id,
      newer.id
    ])
    expect(filterLibraryEntriesByCreatedAt(entries, undefined, 50).map((e) => e.event.id)).toEqual([
      older.id,
      mid.id
    ])
  })

  it('applyCreatedAtBoundsToFilter sets since/until on NIP-01 filters', () => {
    expect(applyCreatedAtBoundsToFilter({ kinds: [30040], limit: 10 }, { since: 1, until: 9 })).toEqual({
      kinds: [30040],
      limit: 10,
      since: 1,
      until: 9
    })
    expect(applyCreatedAtBoundsToFilter({ kinds: [30040] }, null)).toEqual({ kinds: [30040] })
  })

  it('localDateInputToUnixStart/End use local calendar day bounds', () => {
    const start = localDateInputToUnixStart('2024-06-15')
    const end = localDateInputToUnixEnd('2024-06-15')
    expect(start).toBeDefined()
    expect(end).toBeDefined()
    expect(end!).toBeGreaterThan(start!)
    expect(unixSecondsToLocalDateInput(start)).toBe('2024-06-15')
    expect(localDateInputToUnixStart('not-a-date')).toBeUndefined()
  })

  it('publicationIndexMatchesLanguageQuery matches ISO l tags, not free-text EN books', () => {
    const de = indexEvent('pg-de', [], { created_at: 100 })
    de.tags.push(['l', 'de', 'ISO-639-1'])
    const en = indexEvent('pg-en', [], { created_at: 100 })
    en.tags.push(['l', 'en', 'ISO-639-1'])
    en.tags.push(['title', 'Der Name der Rose']) // free-text "de" must not count
    const enOnly = indexEvent('pg-en-only', [], { created_at: 100 })
    enOnly.tags.push(['l', 'en', 'ISO-639-1'])
    enOnly.tags.push(['title', 'Historical thinking and other unnatural acts']) // contains "nl"
    const booklistOnly = indexEvent('pg-label', [], { created_at: 100 })
    booklistOnly.tags.push(['l', 'booklist', 'ugc'])
    const nl = indexEvent('pg-nl', [], { created_at: 100 })
    nl.tags.push(['l', 'nl', 'ISO-639-1'])

    expect(publicationIndexMatchesLanguageQuery(de, 'de')).toBe(true)
    expect(publicationIndexMatchesLanguageQuery(de, 'DE')).toBe(true)
    expect(publicationIndexMatchesLanguageQuery(en, 'de')).toBe(false)
    expect(publicationIndexMatchesLanguageQuery(booklistOnly, 'de')).toBe(false)
    expect(publicationIndexMatchesLanguageQuery(enOnly, 'NL')).toBe(false)
    expect(publicationIndexMatchesLanguageQuery(nl, 'NL')).toBe(true)
  })

  it('buildDocumentRelayStructuredTagFilters language uses #l codes', () => {
    const filters = buildDocumentRelayStructuredTagFilters({ language: 'DE' })
    expect(filters).toHaveLength(1)
    expect((filters[0] as { '#l'?: string[] })['#l']).toEqual(
      expect.arrayContaining(['DE', 'de'])
    )
  })

  it('buildDocumentRelayStructuredTagFilters language is a single #l filter', () => {
    const filters = buildDocumentRelayStructuredTagFilters({ language: 'NL' })
    expect(filters).toHaveLength(1)
    const codes = (filters[0] as { '#l'?: string[]; kinds?: number[] })['#l'] ?? []
    expect(codes).toEqual(expect.arrayContaining(['NL', 'nl']))
    expect(filters[0]?.kinds).toEqual([ExtendedKind.PUBLICATION])
  })
})
