import { ExtendedKind } from '@/constants'
import {
  getParentEventHexId,
  getRootEventHexId,
  isReplyNoteEvent,
  normalizeReplaceableCoordinateString,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

export type TRelayThreadHeatBubble = {
  rootId: string
  heat: number
  postCount: number
  uniqueAuthors: number
  followAuthorsInThread: number
  snippet: string
  lastActivity: number
  rootEvent?: Event
}

/** Undirected link between thread roots (cross-refs, OP-anchor refs, or shared `a`/`A` coordinates). */
export type TRelayThreadHeatEdge = { a: string; b: string }

/** Minimum feed-filtered notes in a thread to appear as a bubble. */
export const RELAY_THREAD_HEAT_MIN_INTERACTIONS = 5

function collapseSnippet(content: string, maxLen = 160): string {
  const t = content.replace(/\s+/g, ' ').trim().slice(0, maxLen)
  return t || '…'
}

/** Map kind 1 / 11 events to a thread root id for aggregation. */
export function threadRootIdForHeat(ev: Event): string | null {
  if (ev.kind !== kinds.ShortTextNote && ev.kind !== ExtendedKind.DISCUSSION) return null
  if (!ev.pubkey?.trim()) return null

  if (ev.kind === kinds.ShortTextNote && !isReplyNoteEvent(ev)) {
    return ev.id.toLowerCase()
  }

  const rootHex = getRootEventHexId(ev)?.trim().toLowerCase()
  const parentHex = getParentEventHexId(ev)?.trim().toLowerCase()
  const raw = (rootHex || parentHex || ev.id).toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(raw)) return ev.id.toLowerCase()
  return resolveDeclaredThreadRootEventHex(raw)
}

/**
 * Group recent notes into thread roots; score activity + author spread + how many of your follows posted.
 * `since` is the window start (unix seconds) for recency scoring only.
 *
 * **Inclusion:** every distinct thread root with at least one kind **1** or **11** event becomes one row
 * (no minimum reply count). **Heat** only ranks rows: `postCount + 1.6×uniqueAuthors + 11×followAuthorsInThread + recencyBoost`.
 */
export function buildRelayThreadHeatBubbles(
  events: Event[],
  followPubkeys: Set<string>,
  since: number
): TRelayThreadHeatBubble[] {
  const follow = followPubkeys
  const now = Math.floor(Date.now() / 1000)
  const span = Math.max(3600, now - since)

  const byRoot = new Map<string, { authors: Set<string>; posts: Event[] }>()
  for (const ev of events) {
    const rid = threadRootIdForHeat(ev)
    if (!rid) continue
    const bucket = byRoot.get(rid) ?? { authors: new Set<string>(), posts: [] }
    const author = ev.pubkey?.trim().toLowerCase()
    if (author) bucket.authors.add(author)
    bucket.posts.push(ev)
    byRoot.set(rid, bucket)
  }

  const rows: TRelayThreadHeatBubble[] = []
  for (const [rootId, { authors, posts }] of byRoot) {
    let followAuthorsInThread = 0
    for (const a of authors) {
      if (follow.has(a)) followAuthorsInThread++
    }
    const postCount = posts.length
    const uniqueAuthors = authors.size
    let lastActivity = 0
    for (const p of posts) {
      if (p.created_at > lastActivity) lastActivity = p.created_at
    }
    const recencyBoost = ((lastActivity - since) / span) * 14

    const heat =
      postCount +
      uniqueAuthors * 1.6 +
      followAuthorsInThread * 11 +
      recencyBoost

    const rootEvent = posts.find(
      (e) =>
        e.id.toLowerCase() === rootId &&
        (e.kind === kinds.ShortTextNote || e.kind === ExtendedKind.DISCUSSION)
    )
    /** Text for preview / hover: always prefer the OP, never an early reply. */
    const opForSnippet = (() => {
      if (rootEvent) return rootEvent
      const kind1Or11 = posts.filter(
        (e) => e.kind === kinds.ShortTextNote || e.kind === ExtendedKind.DISCUSSION
      )
      const kind1TopLevel = kind1Or11.find((e) => e.kind === kinds.ShortTextNote && !isReplyNoteEvent(e))
      if (kind1TopLevel) return kind1TopLevel
      const sorted = [...kind1Or11].sort((a, b) => a.created_at - b.created_at)
      return sorted[0]
    })()
    const snippetSource = opForSnippet?.content?.trim() ?? ''

    rows.push({
      rootId,
      heat,
      postCount,
      uniqueAuthors,
      followAuthorsInThread,
      snippet: collapseSnippet(snippetSource),
      lastActivity,
      rootEvent
    })
  }

  rows.sort((a, b) => b.heat - a.heat)
  return rows
}

const EVENT_REF_TAG_NAMES = new Set(['e', 'E', 'q'])

/**
 * Hex ids that should count as “this thread’s OP / anchor” for link resolution: root id, top-level
 * notes, `e`/`E` markers `root`, and declared root/parent hex from notes in the thread (so refs to
 * the OP still connect when the OP event is missing from {@link feedNotes}).
 */
function collectOpIdCandidatesForRoot(r: string, feedNotes: Event[]): Set<string> {
  const rLower = r.toLowerCase()
  const out = new Set<string>()
  out.add(rLower)
  for (const ev of feedNotes) {
    if (threadRootIdForHeat(ev) !== rLower) continue
    out.add(ev.id.toLowerCase())
    const rootHex = getRootEventHexId(ev)?.trim().toLowerCase()
    if (rootHex && /^[0-9a-f]{64}$/.test(rootHex)) out.add(rootHex)
    const parentHex = getParentEventHexId(ev)?.trim().toLowerCase()
    if (parentHex && /^[0-9a-f]{64}$/.test(parentHex)) out.add(parentHex)
    if (ev.kind === kinds.ShortTextNote && !isReplyNoteEvent(ev)) {
      out.add(ev.id.toLowerCase())
    }
    for (const t of ev.tags ?? []) {
      if ((t[0] === 'e' || t[0] === 'E') && t[1] && String(t[3] ?? '').toLowerCase() === 'root') {
        const id = t[1].trim().toLowerCase()
        if (/^[0-9a-f]{64}$/.test(id)) out.add(id)
      }
    }
  }
  return out
}

/**
 * Build edges between thread roots that appear in {@link rootIdsInView} when:
 * - some note references another note id via `e` / `E` / `q` (including another thread’s OP when
 *   that OP is only visible via tags, not as a loaded event), or
 * - two threads each have a note tagging the same replaceable coordinate (`a` / `A`, NIP-33).
 */
export function buildRelayThreadHeatEdges(
  feedNotes: Event[],
  rootIdsInView: ReadonlySet<string>
): TRelayThreadHeatEdge[] {
  const idToRoot = new Map<string, string>()
  for (const ev of feedNotes) {
    const r = threadRootIdForHeat(ev)
    if (r) idToRoot.set(ev.id.toLowerCase(), r)
  }

  /** Note id / OP-anchor hex → thread root (for refs that never appear as `feedNotes` rows). */
  const opHexToRoot = new Map<string, string>()
  for (const r of rootIdsInView) {
    for (const h of collectOpIdCandidatesForRoot(r, feedNotes)) {
      opHexToRoot.set(h, r)
    }
  }

  const seen = new Set<string>()
  const out: TRelayThreadHeatEdge[] = []

  const addEdge = (x: string, y: string) => {
    if (x === y || !rootIdsInView.has(x) || !rootIdsInView.has(y)) return
    const [a, b] = x < y ? [x, y] : [y, x]
    const key = `${a}:${b}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ a, b })
  }

  for (const ev of feedNotes) {
    const r = threadRootIdForHeat(ev)
    if (!r || !rootIdsInView.has(r)) continue
    for (const tag of ev.tags ?? []) {
      const name = tag[0]
      if (typeof name !== 'string' || !EVENT_REF_TAG_NAMES.has(name)) continue
      const ref = String(tag[1] ?? '')
        .trim()
        .toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(ref)) continue
      let otherRoot = idToRoot.get(ref) ?? opHexToRoot.get(ref) ?? null
      if (otherRoot == null && rootIdsInView.has(ref)) {
        otherRoot = ref
      }
      if (otherRoot != null) addEdge(r, otherRoot)
    }
  }

  /** Normalized `kind:pubkey:d` → thread roots that tag it on at least one note in the corpus. */
  const coordToRoots = new Map<string, Set<string>>()
  for (const ev of feedNotes) {
    const r = threadRootIdForHeat(ev)
    if (!r || !rootIdsInView.has(r)) continue
    for (const tag of ev.tags ?? []) {
      const name = tag[0]
      if (name !== 'a' && name !== 'A') continue
      const raw = tag[1]
      if (typeof raw !== 'string' || !raw.trim()) continue
      const norm = normalizeReplaceableCoordinateString(raw)
      if (!norm) continue
      let set = coordToRoots.get(norm)
      if (!set) {
        set = new Set()
        coordToRoots.set(norm, set)
      }
      set.add(r)
    }
  }
  for (const roots of coordToRoots.values()) {
    if (roots.size < 2) continue
    const arr = [...roots]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        addEdge(arr[i], arr[j])
      }
    }
  }

  return out
}
