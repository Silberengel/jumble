import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  coordinateToNaddr,
  getWikiDeferTarget,
  getWikiForkSource,
  normalizeWikiDTag,
  parseWikiMergeAcceptance,
  parseWikiMergeRequest,
  parseWikiRedirect
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
