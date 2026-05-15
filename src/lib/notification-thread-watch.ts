import { ExtendedKind } from '@/constants'
import {
  getParentEventHexId,
  getRootEventHexId,
  isNip18RepostKind,
  isReplyNoteEvent,
  normalizeReplaceableCoordinateString,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { kinds } from 'nostr-tools'
import type { Event } from 'nostr-tools'

/** Max `e` ids per REQ filter shard (relay limits). */
export const NOTIFICATION_THREAD_WATCH_E_CHUNK = 24
/** Max `a` coordinates per REQ filter shard. */
export const NOTIFICATION_THREAD_WATCH_A_CHUNK = 16
/** Cap stored refs driving live `#e` / `#a` shards (newest wins by list tag order). */
export const NOTIFICATION_THREAD_WATCH_MAX_E_IDS = 120
export const NOTIFICATION_THREAD_WATCH_MAX_A_COORDS = 60

export type TThreadWatchListRefs = {
  eHexLower: Set<string>
  aCoordLower: Set<string>
}

export function emptyThreadWatchRefs(): TThreadWatchListRefs {
  return { eHexLower: new Set<string>(), aCoordLower: new Set<string>() }
}

export function parseThreadWatchListRefs(ev: Event | null | undefined): TThreadWatchListRefs {
  const eHexLower = new Set<string>()
  const aCoordLower = new Set<string>()
  if (!ev?.tags) return { eHexLower, aCoordLower }
  for (const t of ev.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      eHexLower.add(t[1].toLowerCase())
    }
    if ((t[0] === 'a' || t[0] === 'A') && t[1]) {
      const n = normalizeReplaceableCoordinateString(t[1])
      if (n) aCoordLower.add(n)
    }
  }
  return { eHexLower, aCoordLower }
}

function addResolvedHexCandidates(event: Event, into: Set<string>) {
  const add = (h?: string) => {
    if (!h || !/^[0-9a-f]{64}$/i.test(h)) return
    const L = h.toLowerCase()
    into.add(L)
    into.add(resolveDeclaredThreadRootEventHex(L))
  }
  add(getRootEventHexId(event))
  add(getParentEventHexId(event))
  for (const t of event.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      add(t[1])
    }
  }
}

function listNormalizedACoordsFromEvent(event: Event): string[] {
  const out: string[] = []
  for (const t of event.tags) {
    if ((t[0] === 'a' || t[0] === 'A') && t[1]) {
      const n = normalizeReplaceableCoordinateString(t[1])
      if (n) out.push(n)
    }
  }
  return [...new Set(out)]
}

export function threadWatchMatchesRefs(
  event: Event,
  refs: TThreadWatchListRefs
): boolean {
  if (!refs.eHexLower.size && !refs.aCoordLower.size) return false
  const hexCandidates = new Set<string>()
  addResolvedHexCandidates(event, hexCandidates)
  for (const h of hexCandidates) {
    if (refs.eHexLower.has(h)) return true
  }
  for (const ac of listNormalizedACoordsFromEvent(event)) {
    if (refs.aCoordLower.has(ac)) return true
  }
  return false
}

function threadWatchListTagMatchesEvent(tag: string[], event: Event): boolean {
  const k = tag[0]
  if ((k === 'e' || k === 'E') && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
    const id = tag[1].toLowerCase()
    const refs: TThreadWatchListRefs = { eHexLower: new Set([id]), aCoordLower: new Set() }
    return threadWatchMatchesRefs(event, refs)
  }
  if ((k === 'a' || k === 'A') && tag[1]) {
    const n = normalizeReplaceableCoordinateString(tag[1])
    if (!n) return false
    const refs: TThreadWatchListRefs = { eHexLower: new Set(), aCoordLower: new Set([n]) }
    return threadWatchMatchesRefs(event, refs)
  }
  return false
}

/**
 * Drops every `e` / `a` ref that applies to `event` (same rules as {@link threadWatchMatchesRefs}),
 * so toggling off works when the list stores a thread root id but the UI row is a reply (or vice versa).
 */
export function listTagsAfterRemovingThreadWatchMatches(
  listTags: string[][],
  event: Event
): string[][] | null {
  let changed = false
  const next = listTags.filter((t) => {
    if (threadWatchListTagMatchesEvent(t, event)) {
      changed = true
      return false
    }
    return true
  })
  return changed ? next : null
}

/** Replies, reactions, reposts, zaps-on-note, comments, poll votes, highlights — not plain top-level notes. */
export function isNotificationThreadInteractionEvent(event: Event): boolean {
  if (event.kind === kinds.ShortTextNote) return isReplyNoteEvent(event)
  if (event.kind === kinds.Reaction || event.kind === ExtendedKind.EXTERNAL_REACTION) return true
  if (isNip18RepostKind(event.kind)) return true
  if (event.kind === kinds.Zap) {
    return event.tags.some(
      (t) => t[0] === 'e' || t[0] === 'E' || t[0] === 'a' || t[0] === 'A'
    )
  }
  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) return true
  if (event.kind === ExtendedKind.POLL_RESPONSE) return true
  if (event.kind === kinds.Highlights) return true
  return false
}

export function extractEHexIdsForNotificationReq(refs: TThreadWatchListRefs): string[] {
  return [...refs.eHexLower].slice(0, NOTIFICATION_THREAD_WATCH_MAX_E_IDS)
}

export function extractACoordsForNotificationReq(refs: TThreadWatchListRefs): string[] {
  return [...refs.aCoordLower].slice(0, NOTIFICATION_THREAD_WATCH_MAX_A_COORDS)
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return arr.length ? [arr] : []
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}
