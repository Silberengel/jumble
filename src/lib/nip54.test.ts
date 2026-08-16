import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  coordinateToNaddr,
  getWikiDeferTarget,
  getWikiForkSource,
  indexSlug,
  normalizeWikiDTag,
  parseWikiMergeAcceptance,
  parseWikiMergeRequest,
  parseWikiRedirect,
  wikiDTagVariants,
  wikiMergeRequestResolution
} from '@/lib/nip54'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)
const PK2 = 'b'.repeat(64)
const ID = 'c'.repeat(64)
const ID2 = 'd'.repeat(64)

function ev(partial: Partial<Event>): Event {
  return {
    id: ID,
    pubkey: PK,
    created_at: 0,
    kind: 1,
    tags: [],
    content: '',
    sig: '',
    ...partial
  } as Event
}

describe('normalizeWikiDTag', () => {
  it('lowercases, removes punctuation, maps whitespace to dashes', () => {
    expect(normalizeWikiDTag('Bitcoin Wallet')).toBe('bitcoin-wallet')
    expect(normalizeWikiDTag("What's Up?")).toBe('whats-up')
    expect(normalizeWikiDTag('  Hello   World  ')).toBe('hello-world')
  })

  it('preserves non-ASCII letters and numbers', () => {
    expect(normalizeWikiDTag('ウィキペディア')).toBe('ウィキペディア')
    expect(normalizeWikiDTag('Café 2')).toBe('café-2')
  })

  it('preserves hyphens in slugs like NKBIP-01', () => {
    expect(normalizeWikiDTag('NKBIP-01')).toBe('nkbip-01')
    expect(normalizeWikiDTag('nkbip-01')).toBe('nkbip-01')
    expect(normalizeWikiDTag('Jean-Baptiste Lamarck')).toBe('jean-baptiste-lamarck')
  })
})

describe('indexSlug', () => {
  it('ASCII-folds and preserves hyphens for T/N filters', () => {
    expect(indexSlug('Jane Austen')).toBe('jane-austen')
    expect(indexSlug('Jean-Baptiste Lamarck')).toBe('jean-baptiste-lamarck')
    expect(indexSlug('Étienne Geoffroy Saint-Hilaire')).toBe('etienne-geoffroy-saint-hilaire')
    expect(indexSlug('Redacted Science')).toBe('redacted-science')
  })
})

describe('wikiDTagVariants', () => {
  it('keeps hyphens and does not invent concatenated twins', () => {
    expect(wikiDTagVariants('Jean-Baptiste Lamarck')).toEqual(['jean-baptiste-lamarck'])
    expect(wikiDTagVariants('jean-baptiste-lamarck')).toEqual(['jean-baptiste-lamarck'])
  })

  it('adds an ASCII-folded twin for accented wiki titles', () => {
    expect(wikiDTagVariants('Étienne Geoffroy Saint-Hilaire')).toEqual(
      expect.arrayContaining([
        'étienne-geoffroy-saint-hilaire',
        'etienne-geoffroy-saint-hilaire'
      ])
    )
    expect(wikiDTagVariants('Étienne Geoffroy Saint-Hilaire')).not.toEqual(
      expect.arrayContaining(['étienne-geoffroy-sainthilaire', 'etienne-geoffroy-sainthilaire'])
    )
  })
})

describe('wiki marker parsing', () => {
  it('reads fork source from a 30818 article', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK2}:bitcoin`
    const article = ev({
      kind: ExtendedKind.WIKI_ARTICLE,
      tags: [
        ['d', 'bitcoin'],
        ['a', coord, 'wss://r', 'fork'],
        ['e', ID2, 'wss://r', 'fork']
      ]
    })
    const fork = getWikiForkSource(article)
    expect(fork?.coordinate).toBe(coord)
    expect(fork?.eventId).toBe(ID2)
    expect(getWikiDeferTarget(article)).toBeUndefined()
  })

  it('reads defer target from a 30818 article', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK2}:bitcoin`
    const article = ev({
      kind: ExtendedKind.WIKI_ARTICLE,
      tags: [
        ['d', 'bitcoin'],
        ['a', coord, '', 'defer'],
        ['e', ID2, '', 'defer']
      ]
    })
    expect(getWikiDeferTarget(article)?.coordinate).toBe(coord)
  })

  it('parses a kind:818 merge request', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK2}:bitcoin`
    const mr = ev({
      kind: ExtendedKind.WIKI_MERGE_REQUEST,
      tags: [
        ['a', coord, 'wss://r'],
        ['p', PK2],
        ['e', ID2, 'wss://r'],
        ['e', ID, 'wss://r', 'fork']
      ]
    })
    const parsed = parseWikiMergeRequest(mr)
    expect(parsed?.destinationCoordinate).toBe(coord)
    expect(parsed?.destinationPubkey).toBe(PK2)
    expect(parsed?.basedOnEventId).toBe(ID2)
    expect(parsed?.forkEventId).toBe(ID)
  })

  it('parses a kind:819 merge acceptance', () => {
    const acc = ev({
      kind: ExtendedKind.WIKI_MERGE_ACCEPTANCE,
      tags: [
        ['e', ID, 'wss://r', 'result'],
        ['e', ID2, 'wss://r', 'request'],
        ['p', PK2]
      ]
    })
    const parsed = parseWikiMergeAcceptance(acc)
    expect(parsed?.resultEventId).toBe(ID)
    expect(parsed?.requestEventId).toBe(ID2)
    expect(parsed?.requesterPubkey).toBe(PK2)
  })

  it('parses a kind:30819 redirect', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK2}:bitcoin`
    const redirect = ev({
      kind: ExtendedKind.WIKI_REDIRECT,
      tags: [
        ['d', 'btc'],
        ['a', coord, 'wss://r']
      ]
    })
    const parsed = parseWikiRedirect(redirect)
    expect(parsed?.slug).toBe('btc')
    expect(parsed?.targetCoordinate).toBe(coord)
  })
})

describe('coordinateToNaddr', () => {
  it('encodes and round-trips a coordinate', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK}:bitcoin`
    const naddr = coordinateToNaddr(coord)
    expect(naddr).toMatch(/^naddr1/)
  })

  it('returns null for malformed input', () => {
    expect(coordinateToNaddr('not-a-coordinate')).toBeNull()
    expect(coordinateToNaddr('30818:nothex:bitcoin')).toBeNull()
  })
})

describe('wikiMergeRequestResolution', () => {
  it('detects merged and rejected merge requests', () => {
    const coord = `${ExtendedKind.WIKI_ARTICLE}:${PK2}:bitcoin`
    const mr = ev({
      kind: ExtendedKind.WIKI_MERGE_REQUEST,
      tags: [
        ['a', coord],
        ['p', PK2],
        ['e', ID, '', 'fork']
      ]
    })
    const acceptance = ev({
      kind: ExtendedKind.WIKI_MERGE_ACCEPTANCE,
      tags: [['e', mr.id, '', 'request']]
    })
    expect(wikiMergeRequestResolution(mr, [acceptance], [])).toBe('merged')

    const rejectReaction = ev({
      kind: 7,
      pubkey: PK2,
      content: '-',
      tags: [['e', mr.id]]
    })
    expect(wikiMergeRequestResolution(mr, [], [rejectReaction])).toBe('rejected')
    expect(wikiMergeRequestResolution(mr, [], [])).toBe('open')
  })
})
