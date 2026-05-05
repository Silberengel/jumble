import { Fragment, type ReactNode } from 'react'
import { kinds, type Event } from 'nostr-tools'
import { resolveNip84HighlightDisplay } from '@/lib/nip84-highlight-display'

/** Same classes as {@link Highlight} NIP-84 span marks (keep in sync manually). */
export const NIP84_HIGHLIGHT_MARK_CLASSNAME =
  'bg-green-200 dark:bg-green-600 dark:text-white px-1 rounded font-medium'

function stripOuterQuotes(s: string): string {
  let t = s.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1).trim()
  }
  return t
}

function highlightTargetsNoteHex(h: Event, opHex: string): boolean {
  const want = opHex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(want)) return false
  return h.tags.some(
    (t) => (t[0] === 'e' || t[0] === 'E') && typeof t[1] === 'string' && t[1].trim().toLowerCase() === want
  )
}

/** Non-overlapping merged intervals for first occurrence of each highlight’s marked span in `baseText`. */
export function mergeNip84MarkedIntervals(
  baseText: string,
  highlightEvents: Event[],
  opEventHexId: string
): { start: number; end: number }[] {
  const intervals: { start: number; end: number }[] = []
  for (const ev of highlightEvents) {
    if (ev.kind !== kinds.Highlights) continue
    if (!highlightTargetsNoteHex(ev, opEventHexId)) continue
    const { markedSpan } = resolveNip84HighlightDisplay(ev)
    const needle = stripOuterQuotes(markedSpan)
    if (!needle) continue
    const idx = baseText.indexOf(needle)
    if (idx >= 0) intervals.push({ start: idx, end: idx + needle.length })
  }
  if (intervals.length === 0) return []
  intervals.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const cur of intervals) {
    const prev = merged[merged.length - 1]
    if (!prev || cur.start > prev.end) merged.push({ ...cur })
    else prev.end = Math.max(prev.end, cur.end)
  }
  return merged
}

export function renderPlaintextWithNip84MergedMarks(
  baseText: string,
  merged: { start: number; end: number }[]
): ReactNode {
  if (merged.length === 0) return baseText
  const nodes: ReactNode[] = []
  let cursor = 0
  let i = 0
  for (const m of merged) {
    if (cursor < m.start) nodes.push(<Fragment key={`t-${i++}`}>{baseText.slice(cursor, m.start)}</Fragment>)
    nodes.push(
      <mark
        key={`m-${m.start}-${m.end}`}
        className={NIP84_HIGHLIGHT_MARK_CLASSNAME}
        data-nip84-highlight="span"
      >
        {baseText.slice(m.start, m.end)}
      </mark>
    )
    cursor = m.end
  }
  if (cursor < baseText.length) nodes.push(<Fragment key={`t-${i++}`}>{baseText.slice(cursor)}</Fragment>)
  return <>{nodes}</>
}
