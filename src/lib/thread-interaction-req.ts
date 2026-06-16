import {
  ExtendedKind,
  NOTE_STATS_OP_REFERENCE_KINDS,
  NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
} from '@/constants'
import { buildRssArticleUrlThreadInteractionFilters } from '@/lib/rss-web-feed'
import { webBookmarkNostrTargetInteractionFilters } from '@/lib/web-bookmark-nip'
import { kinds, type Filter } from 'nostr-tools'

/** Thread root shapes used by {@link buildThreadInteractionFilters} (matches ReplyNoteList `rootInfo`). */
export type ThreadInteractionRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

function sortedUniqueKinds(kindsList: readonly number[]): number[] {
  return Array.from(new Set(kindsList)).sort((a, b) => a - b)
}

export type BuildThreadInteractionFiltersInput = {
  root: ThreadInteractionRootInfo
  /** Kind of the note/article the user opened (affects zap inclusion). */
  opEventKind: number
  limit: number
  /** Hex id of the note the user opened — also REQ `#e` when it is not the thread root. */
  opEventHexId?: string
}

function appendOpenNoteScopedEventFilters(
  filters: Filter[],
  opEventHexId: string | undefined,
  rootHexIds: readonly string[],
  kindsOnETag: number[],
  kindsOnUpperETag: number[],
  kindsOnQTag: number[],
  limit: number
): void {
  const opHex = opEventHexId?.trim().toLowerCase()
  if (!opHex || !/^[0-9a-f]{64}$/.test(opHex)) return
  const rootSet = new Set(rootHexIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  if (rootSet.has(opHex)) return
  filters.push({ '#e': [opHex], kinds: kindsOnETag, limit })
  filters.push({ '#E': [opHex], kinds: kindsOnUpperETag, limit })
  filters.push({ '#q': [opHex], kinds: kindsOnQTag, limit })
}

/**
 * One relay wave per thread: minimal tag-scoped filters with merged `kinds` arrays.
 * Client code classifies replies vs backlinks; {@link QueryService} splits only when over relay caps.
 */
export function buildThreadInteractionFilters(input: BuildThreadInteractionFiltersInput): Filter[] {
  const { root, opEventKind, limit, opEventHexId } = input

  const kindsNoteCommentVoiceZap = sortedUniqueKinds([
    kinds.ShortTextNote,
    ExtendedKind.COMMENT,
    ExtendedKind.VOICE_COMMENT,
    kinds.Zap,
    ExtendedKind.PAYMENT_NOTIFICATION,
    ExtendedKind.MONERO_TIP_DISCLOSURE,
    ExtendedKind.MONERO_TIP_RECEIPT
  ])
  const kindsPrimaryThread = kindsNoteCommentVoiceZap
  const kindsUpperEThread = sortedUniqueKinds([
    ExtendedKind.COMMENT,
    ExtendedKind.VOICE_COMMENT,
    kinds.Zap,
    ExtendedKind.PAYMENT_NOTIFICATION
  ])

  const kindsOnETag = sortedUniqueKinds([
    ...kindsPrimaryThread,
    kinds.Reaction,
    ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
  ])
  const kindsOnUpperETag = sortedUniqueKinds([
    ...kindsUpperEThread,
    ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
  ])
  const kindsOnQTag = sortedUniqueKinds([
    kinds.ShortTextNote,
    ExtendedKind.COMMENT,
    ExtendedKind.VOICE_COMMENT,
    ...NOTE_STATS_OP_REFERENCE_KINDS
  ])

  if (root.type === 'I') {
    return buildRssArticleUrlThreadInteractionFilters(root.id, limit)
  }

  const filters: Filter[] = []

  if (root.type === 'E') {
    const rootHex = root.id.trim().toLowerCase()
    filters.push({ '#e': [rootHex], kinds: kindsOnETag, limit })
    filters.push({ '#E': [rootHex], kinds: kindsOnUpperETag, limit })
    filters.push({ '#q': [rootHex], kinds: kindsOnQTag, limit })
    if (opEventKind === ExtendedKind.PUBLIC_MESSAGE) {
      filters.push({ '#q': [rootHex], kinds: [ExtendedKind.PUBLIC_MESSAGE], limit })
    }
    appendOpenNoteScopedEventFilters(
      filters,
      opEventHexId,
      [rootHex],
      kindsOnETag,
      kindsOnUpperETag,
      kindsOnQTag,
      limit
    )
    return filters
  }

  filters.push({ '#a': [root.id], kinds: kindsOnETag, limit })
  filters.push({ '#A': [root.id], kinds: kindsOnUpperETag, limit })
  const rootHexIds: string[] = []
  if (/^[0-9a-f]{64}$/i.test(root.eventId)) {
    const eSnap = root.eventId.trim().toLowerCase()
    rootHexIds.push(eSnap)
    filters.push({ '#e': [eSnap], kinds: kindsOnETag, limit })
    filters.push({ '#E': [eSnap], kinds: kindsOnUpperETag, limit })
  }
  const qVals = Array.from(
    new Set([root.eventId, root.id].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))
  )
  if (qVals.length > 0) {
    filters.push({ '#q': qVals, kinds: kindsOnQTag, limit })
  }
  appendOpenNoteScopedEventFilters(
    filters,
    opEventHexId,
    rootHexIds,
    kindsOnETag,
    kindsOnUpperETag,
    kindsOnQTag,
    limit
  )
  filters.push(...webBookmarkNostrTargetInteractionFilters(root.id, limit))
  return filters
}

/** Zap / payment filters only — run first so paid thread replies appear before regular replies. */
export function buildThreadSuperchatPriorityFilters(
  input: BuildThreadInteractionFiltersInput
): Filter[] {
  const superchatKinds = new Set<number>([
    kinds.Zap,
    ExtendedKind.PAYMENT_NOTIFICATION,
    ExtendedKind.MONERO_TIP_DISCLOSURE,
    ExtendedKind.MONERO_TIP_RECEIPT
  ])
  const out: Filter[] = []
  for (const filter of buildThreadInteractionFilters(input)) {
    const kindsList = filter.kinds?.filter((k) => superchatKinds.has(k))
    if (!kindsList?.length) continue
    out.push({ ...filter, kinds: kindsList })
  }
  return out
}
