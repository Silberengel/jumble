/**
 * NIP-54 (Wiki) helpers shared across the wiki article renderer, the collaboration UI
 * (forks, deference, merge requests, redirects) and the draft-event builders.
 *
 * Spec: nips-silberengel/54.md (kinds 30818 article, 818 merge request, 819 merge acceptance,
 * 30819 redirect).
 */
import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent } from '@/lib/event'
import { nip19, type Event } from 'nostr-tools'

/**
 * Normalize a wiki `d` tag / wikilink target per NIP-54.
 *
 * - lowercase (case variants folded);
 * - whitespace → `-`;
 * - existing `-` preserved (valid in NIP-54 d-tags);
 * - other punctuation / symbols removed;
 * - consecutive `-` collapsed, leading/trailing `-` trimmed;
 * - **non-ASCII letters preserved** (Japanese, Cyrillic, Arabic, …) and numbers preserved.
 */
export function normalizeWikiDTag(input: string): string {
  const lowered = input.normalize('NFC').toLowerCase()
  let out = ''
  for (const ch of lowered) {
    if (/\s/u.test(ch)) {
      out += '-'
    } else if (ch === '-') {
      out += '-'
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch
    }
    // other punctuation / symbols are dropped
  }
  return out.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/** Strip combining marks so `Étienne` and `Etienne` share a lookup slug. */
export function asciiFoldWikiText(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * NIP-54 `d` plus lookup twins for:
 * - ASCII-folded accents (`Étienne` → also `etienne-…`)
 * - legacy Wikipedia imports that stripped title hyphens (`Jean-Baptiste` → `jeanbaptiste-…`)
 */
export function wikiDTagVariants(input: string): string[] {
  const variants = new Set<string>()

  const addFromRaw = (raw: string) => {
    const d = normalizeWikiDTag(raw)
    if (!d) return
    variants.add(d)
    // Old importer dropped `-` as punctuation before space→hyphen.
    const legacy = normalizeWikiDTag(raw.replace(/-/g, ''))
    if (legacy) variants.add(legacy)
    // When `raw` is already a hyphenated d-tag, try joining adjacent segments so
    // `jean-baptiste-lamarck` also finds imported `jeanbaptiste-lamarck`.
    const parts = d.split('-').filter(Boolean)
    for (let i = 0; i < parts.length - 1; i++) {
      variants.add([...parts.slice(0, i), parts[i] + parts[i + 1], ...parts.slice(i + 2)].join('-'))
    }
  }

  addFromRaw(input)
  const folded = asciiFoldWikiText(input)
  if (folded !== input) addFromRaw(folded)

  return [...variants]
}

/** The marker (4th element) of an `a`/`e` tag, e.g. `fork`, `defer`, `result`, `request`. */
export function getTagMarker(tag: string[]): string | undefined {
  return tag[3]?.trim() || undefined
}

export type WikiReference = {
  /** `kind:pubkey:d` coordinate from an `a` tag, when present. */
  coordinate?: string
  /** Event id from an `e` tag, when present. */
  eventId?: string
  /** Relay hint (from whichever tag carried it). */
  relayHint?: string
}

function readReferenceByMarker(event: Event, marker: string): WikiReference | undefined {
  const aTag = event.tags.find((t) => t[0] === 'a' && getTagMarker(t) === marker && t[1])
  const eTag = event.tags.find((t) => t[0] === 'e' && getTagMarker(t) === marker && t[1])
  if (!aTag && !eTag) return undefined
  return {
    coordinate: aTag?.[1],
    eventId: eTag?.[1],
    relayHint: aTag?.[2] || eTag?.[2] || undefined
  }
}

/** For a kind 30818 article: the source it was forked from (`a`/`e` with `fork` marker). */
export function getWikiForkSource(event: Event): WikiReference | undefined {
  if (event.kind !== ExtendedKind.WIKI_ARTICLE) return undefined
  return readReferenceByMarker(event, 'fork')
}

/** For a kind 30818 article: the version it defers to (`a`/`e` with `defer` marker). */
export function getWikiDeferTarget(event: Event): WikiReference | undefined {
  if (event.kind !== ExtendedKind.WIKI_ARTICLE) return undefined
  return readReferenceByMarker(event, 'defer')
}

/** True when a 30818 article only exists to defer to another version (carries a `defer` marker). */
export function isWikiDeference(event: Event): boolean {
  return !!getWikiDeferTarget(event)
}

/** Whether a kind:818 merge request is closed (merged or rejected by the destination author). */
export function wikiMergeRequestResolution(
  mergeRequest: Event,
  acceptances: Event[],
  reactions: Event[]
): 'merged' | 'rejected' | 'open' {
  if (acceptances.length > 0) return 'merged'
  const destPubkey = parseWikiMergeRequest(mergeRequest)?.destinationPubkey?.toLowerCase()
  if (
    destPubkey &&
    reactions.some(
      (r) => r.pubkey.toLowerCase() === destPubkey && r.content.trim() === '-'
    )
  ) {
    return 'rejected'
  }
  return 'open'
}

export type WikiRedirect = {
  /** Normalized slug this redirect is registered under (its own `d` tag). */
  slug: string
  /** Target article coordinate (`a` tag). */
  targetCoordinate?: string
  relayHint?: string
}

/** Parse a kind 30819 wiki redirect / disambiguation event. */
export function parseWikiRedirect(event: Event): WikiRedirect | undefined {
  if (event.kind !== ExtendedKind.WIKI_REDIRECT) return undefined
  const slug = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1])
  return { slug, targetCoordinate: aTag?.[1], relayHint: aTag?.[2] || undefined }
}

export type WikiMergeRequest = {
  /** Article coordinate to be modified (destination), from the unmarked `a` tag. */
  destinationCoordinate?: string
  /** Destination author pubkey (`p` tag). */
  destinationPubkey?: string
  /** Optional version the change is based on (unmarked `e` tag). */
  basedOnEventId?: string
  /** Id of the forked version to be merged (`e` tag with `fork` marker). */
  forkEventId?: string
  relayHint?: string
}

/** Parse a kind 818 merge request. */
export function parseWikiMergeRequest(event: Event): WikiMergeRequest | undefined {
  if (event.kind !== ExtendedKind.WIKI_MERGE_REQUEST) return undefined
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1])
  const pTag = event.tags.find((t) => t[0] === 'p' && t[1])
  const forkETag = event.tags.find((t) => t[0] === 'e' && getTagMarker(t) === 'fork' && t[1])
  const baseETag = event.tags.find((t) => t[0] === 'e' && !getTagMarker(t) && t[1])
  return {
    destinationCoordinate: aTag?.[1],
    destinationPubkey: pTag?.[1],
    basedOnEventId: baseETag?.[1],
    forkEventId: forkETag?.[1],
    relayHint: aTag?.[2] || forkETag?.[2] || undefined
  }
}

export type WikiMergeAcceptance = {
  /** Id of the resulting merged 30818 version (`e` with `result` marker). */
  resultEventId?: string
  /** Id of the kind 818 request that was accepted (`e` with `request` marker). */
  requestEventId?: string
  /** Pubkey of the merge request author (`p` tag). */
  requesterPubkey?: string
}

/** Parse a kind 819 merge acceptance. */
export function parseWikiMergeAcceptance(event: Event): WikiMergeAcceptance | undefined {
  if (event.kind !== ExtendedKind.WIKI_MERGE_ACCEPTANCE) return undefined
  const resultETag = event.tags.find((t) => t[0] === 'e' && getTagMarker(t) === 'result' && t[1])
  const requestETag = event.tags.find((t) => t[0] === 'e' && getTagMarker(t) === 'request' && t[1])
  const pTag = event.tags.find((t) => t[0] === 'p' && t[1])
  return {
    resultEventId: resultETag?.[1],
    requestEventId: requestETag?.[1],
    requesterPubkey: pTag?.[1]
  }
}

/** Coordinate (`kind:pubkey:d`) for any addressable wiki event (used to match versions/redirects). */
export function wikiArticleCoordinate(event: Event): string {
  return getReplaceableCoordinateFromEvent(event)
}

/** Encode a `kind:pubkey:d` coordinate into an `naddr` for embedding/linking. */
export function coordinateToNaddr(coordinate: string, relayHint?: string): string | null {
  const idx = coordinate.indexOf(':')
  if (idx < 0) return null
  const kind = Number(coordinate.slice(0, idx))
  const rest = coordinate.slice(idx + 1)
  const idx2 = rest.indexOf(':')
  const pubkey = idx2 < 0 ? rest : rest.slice(0, idx2)
  const identifier = idx2 < 0 ? '' : rest.slice(idx2 + 1)
  if (!Number.isFinite(kind) || !/^[0-9a-f]{64}$/i.test(pubkey)) return null
  try {
    return nip19.naddrEncode({
      kind,
      pubkey: pubkey.toLowerCase(),
      identifier,
      relays: relayHint ? [relayHint] : undefined
    })
  } catch {
    return null
  }
}
