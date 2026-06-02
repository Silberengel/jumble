import { ExtendedKind } from '@/constants'
import { extractHashtagsFromContent, isValidNormalizedTopicKey, normalizeTopic } from '@/lib/discussion-topics'
import { eventPassesNoteListKindPicker } from '@/lib/feed-kind-filter'
import { muteSetHas } from '@/lib/mute-set'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

const MAX_BUBBLES = 10
/** Max profile avatars shown around each topic bubble (by tag usage count). */
const MAX_BUBBLE_AVATARS = 7

export type TTopicKeywordBubble = {
  key: string
  score: number
  topicNoteCount: number
  keywordNoteCount: number
  pubkeys: string[]
}

type TopicKeyAccum = {
  topicNoteCount: number
  keywordNoteCount: number
  pubkeyHits: Map<string, number>
}

function topPubkeysForTopic(
  hits: Map<string, number>,
  limit: number,
  mutePubkeySet?: ReadonlySet<string>
): string[] {
  return [...hits.entries()]
    .filter(([pk]) => !mutePubkeySet || !muteSetHas(mutePubkeySet, pk))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([pk]) => pk)
}

export function buildTopicKeywordBubbles(
  events: Event[],
  showKinds: readonly number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean,
  mutePubkeySet?: ReadonlySet<string>
): TTopicKeywordBubble[] {
  const accum = new Map<string, TopicKeyAccum>()

  const bump = (key: string, ev: Event, viaTopicTag: boolean) => {
    if (!isValidNormalizedTopicKey(key)) return
    let row = accum.get(key)
    if (!row) {
      row = { topicNoteCount: 0, keywordNoteCount: 0, pubkeyHits: new Map() }
      accum.set(key, row)
    }
    if (viaTopicTag) row.topicNoteCount += 1
    else row.keywordNoteCount += 1
    const pk = ev.pubkey.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(pk)) {
      row.pubkeyHits.set(pk, (row.pubkeyHits.get(pk) ?? 0) + 1)
    }
  }

  for (const ev of events) {
    if (mutePubkeySet && muteSetHas(mutePubkeySet, ev.pubkey)) continue
    if (!eventPassesNoteListKindPicker(ev, showKinds, showKind1OPs, showKind1Replies, showKind1111)) continue
    const topics = new Set<string>()
    for (const row of ev.tags) {
      if (row[0] === 't' && row[1]) {
        const n = normalizeTopic(row[1])
        if (n && isValidNormalizedTopicKey(n)) topics.add(n)
      }
    }
    const kws = new Set(extractHashtagsFromContent(ev.content ?? ''))

    for (const k of topics) bump(k, ev, true)
    for (const k of kws) bump(k, ev, false)
  }

  const out: TTopicKeywordBubble[] = []
  for (const [key, row] of accum) {
    if (!isValidNormalizedTopicKey(key)) continue
    const score = row.topicNoteCount + row.keywordNoteCount
    if (score <= 0) continue
    out.push({
      key,
      score,
      topicNoteCount: row.topicNoteCount,
      keywordNoteCount: row.keywordNoteCount,
      pubkeys: topPubkeysForTopic(row.pubkeyHits, MAX_BUBBLE_AVATARS, mutePubkeySet)
    })
  }
  out.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
  return out.slice(0, MAX_BUBBLES)
}

/** Kinds scanned for the topic keyword heat map (exported for the component fetch layer). */
export const TOPIC_KEYWORD_MAP_KINDS = [kinds.ShortTextNote, ExtendedKind.DISCUSSION] as const
