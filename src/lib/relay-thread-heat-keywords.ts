import type { TRelayThreadHeatBubble } from '@/lib/relay-thread-heat'

/** Very common English tokens to ignore when clustering (cheap overlap signal). */
const STOPWORDS = new Set(
  `a about after again all also an and any are as at be been before being between both but by can could did do does doing done each even every few for from further had has have having he her here hers him his how i if in into is it its just like made make many may me more most much must my no nor not now of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your`
    .split(/\s+/)
)

function heatBubbleTextForKeywords(row: TRelayThreadHeatBubble): string {
  const parts = [row.snippet]
  const c = row.rootEvent?.content?.trim()
  if (c) parts.push(c.slice(0, 500))
  return parts.join('\n')
}

/** Distinct keywords (length ≥ 4, not stopword) from snippet + start of root note. */
export function extractHeatKeywords(row: TRelayThreadHeatBubble): string[] {
  const raw = heatBubbleTextForKeywords(row)
  const lower = raw.toLowerCase()
  const words = lower.match(/[a-zäöüßåæøéèêëáíóúñç0-9]{4,}/gi) ?? []
  const tags = [...lower.matchAll(/#([a-zäöüßåæøéèêëáíóúñç0-9_]{3,})/gi)].map((m) => m[1])
  const out: string[] = []
  const seen = new Set<string>()
  for (const w of [...words, ...tags]) {
    const t = w.toLowerCase()
    if (STOPWORDS.has(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= 22) break
  }
  return out
}

/**
 * Re-order bubbles so threads that share at least one keyword appear next to each other in DOM
 * order (flex-wrap packs them closer). Uses union–find on roots per shared keyword; components
 * are ordered by their strongest thread, then by heat inside the component.
 */
export function orderHeatBubblesByKeywordProximity(rows: TRelayThreadHeatBubble[]): TRelayThreadHeatBubble[] {
  if (rows.length <= 1) return rows

  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    const p = parent.get(x)!
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const row of rows) {
    parent.set(row.rootId, row.rootId)
  }

  const keywordToRoots = new Map<string, string[]>()
  for (const row of rows) {
    for (const kw of extractHeatKeywords(row)) {
      const arr = keywordToRoots.get(kw) ?? []
      arr.push(row.rootId)
      keywordToRoots.set(kw, arr)
    }
  }

  for (const ids of keywordToRoots.values()) {
    if (ids.length < 2) continue
    const head = ids[0]
    for (let i = 1; i < ids.length; i++) {
      union(head, ids[i])
    }
  }

  const componentToMembers = new Map<string, TRelayThreadHeatBubble[]>()
  for (const row of rows) {
    const c = find(row.rootId)
    const arr = componentToMembers.get(c) ?? []
    arr.push(row)
    componentToMembers.set(c, arr)
  }

  const components = [...componentToMembers.values()].map((members) => ({
    members: [...members].sort((a, b) => b.heat - a.heat),
    maxHeat: Math.max(...members.map((m) => m.heat), 0)
  }))
  components.sort((a, b) => b.maxHeat - a.maxHeat)
  return components.flatMap((c) => c.members)
}
