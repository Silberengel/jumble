import { ExtendedKind, isNip52CalendarCardKind } from '@/constants'
import { replaceableEventDedupeKey } from '@/lib/event'
import { generateBech32IdFromATag, tagNameEquals } from '@/lib/tag'
import { Event } from 'nostr-tools'

/** NIP-52 collaborative calendar (addressable kind). */
export const NIP52_CALENDAR_KIND = 31924

export type Nip52CalendarRTag = { value: string; isHttpUrl: boolean }

export type Nip52CalendarInclusionRow = { coordinate: string; naddr: string }

export type Nip52CalendarTagExtras = {
  locations: string[]
  rTags: Nip52CalendarRTag[]
  dayGranularities: string[]
  calendarInclusions: Nip52CalendarInclusionRow[]
  unknownTags: string[][]
}

const NIP52_CALENDAR_EVENT_KNOWN_TAG_NAMES = new Set([
  'd',
  'D',
  'title',
  'summary',
  'image',
  'location',
  'g',
  'p',
  't',
  'r',
  'a',
  'start',
  'end',
  'start_tzid',
  'end_tzid',
  'name',
  /** App attribution; rendered under the title in calendar UI, not in “other tags”. */
  'client'
])

/** Parsed NIP-52 calendar event tags not fully covered by {@link getCalendarEventMeta}. */
export function getNip52CalendarEventTagExtras(event: Event): Nip52CalendarTagExtras {
  const locations = event.tags
    .filter(tagNameEquals('location'))
    .map((t) => t[1]?.trim())
    .filter((x): x is string => !!x)
  const rTags: Nip52CalendarRTag[] = event.tags
    .filter(tagNameEquals('r'))
    .map((t) => {
      const v = t[1]?.trim() ?? ''
      return { value: v, isHttpUrl: /^https?:\/\//i.test(v) }
    })
    .filter((e) => e.value.length > 0)
  const dayGranularities = event.tags
    .filter((t) => t[0] === 'D')
    .map((t) => t[1]?.trim())
    .filter((x): x is string => !!x)
  const calendarInclusions: Nip52CalendarInclusionRow[] = []
  for (const t of event.tags.filter(tagNameEquals('a'))) {
    const coord = t[1]?.trim()
    if (!coord) continue
    const kindStr = coord.split(':')[0] ?? ''
    const kind = parseInt(kindStr, 10)
    if (!Number.isFinite(kind) || kind !== NIP52_CALENDAR_KIND) continue
    const naddr = generateBech32IdFromATag(t)
    if (!naddr) continue
    calendarInclusions.push({ coordinate: coord, naddr })
  }
  const unknownTags = event.tags.filter((tag) => {
    const n = tag[0]
    if (n == null || n === '') return false
    return !NIP52_CALENDAR_EVENT_KNOWN_TAG_NAMES.has(n)
  })
  return { locations, rTags, dayGranularities, calendarInclusions, unknownTags }
}

export interface CalendarEventMeta {
  title: string
  summary: string
  image: string
  /** Time-based: Unix seconds. Date-based: undefined. */
  start: number | undefined
  /** Time-based: Unix seconds. Date-based: undefined. */
  end: number | undefined
  /** Date-based: YYYY-MM-DD. Time-based: undefined. */
  startDate: string
  /** Date-based: YYYY-MM-DD (exclusive end). Time-based: undefined. */
  endDate: string
  isDateBased: boolean
  /** First `r` tag with an http(s) URL (join / registration link). */
  joinUrl: string
  /** Same as {@link joinUrl}; every http(s) `r` value. */
  rUrl: string
  rUrls: string[]
  /** All `location` tag values (NIP-52 allows repeated). */
  locations: string[]
  /** First location, for compact UI. */
  location: string
  /** `d` tag (replaceable identifier). */
  d: string
  /** `g` tag (geohash). */
  geo: string
  /** `start_tzid` (IANA zone). */
  startTzid: string
  /** `end_tzid` (IANA zone). */
  endTzid: string
  topics: string[]
}

export function getCalendarEventMeta(event: Event): CalendarEventMeta {
  const rawTitle = event.tags.find(tagNameEquals('title'))?.[1]?.trim() ?? ''
  const nameFallback = event.tags.find(tagNameEquals('name'))?.[1]?.trim() ?? ''
  const title = rawTitle || nameFallback
  const summary = event.tags.find(tagNameEquals('summary'))?.[1] ?? ''
  const image = event.tags.find(tagNameEquals('image'))?.[1] ?? ''
  const startStr = event.tags.find(tagNameEquals('start'))?.[1]
  const endStr = event.tags.find(tagNameEquals('end'))?.[1]
  const locations = event.tags
    .filter(tagNameEquals('location'))
    .map((t) => t[1]?.trim())
    .filter((x): x is string => !!x)
  const location = locations[0] ?? ''
  const d = event.tags.find(tagNameEquals('d'))?.[1] ?? ''
  const geo = event.tags.find(tagNameEquals('g'))?.[1] ?? ''
  const startTzid = event.tags.find(tagNameEquals('start_tzid'))?.[1] ?? ''
  const endTzid = event.tags.find(tagNameEquals('end_tzid'))?.[1] ?? ''
  const rUrls = event.tags
    .filter(tagNameEquals('r'))
    .map((t) => t[1]?.trim())
    .filter((u): u is string => !!u && (u.startsWith('http://') || u.startsWith('https://')))
  const rUrl = rUrls[0] ?? ''
  const joinUrl = rUrl
  const topics = event.tags.filter(tagNameEquals('t')).map((t) => t[1]?.trim()).filter(Boolean)
  const isDateBased = event.kind === ExtendedKind.CALENDAR_EVENT_DATE
  if (isDateBased) {
    return {
      title,
      summary,
      image,
      start: undefined,
      end: undefined,
      startDate: startStr ?? '',
      endDate: endStr ?? '',
      isDateBased: true,
      joinUrl,
      rUrl,
      rUrls,
      locations,
      location,
      d,
      geo,
      startTzid,
      endTzid,
      topics
    }
  }
  const start = startStr ? parseInt(startStr, 10) : undefined
  const end = endStr ? parseInt(endStr, 10) : undefined
  return {
    title,
    summary,
    image,
    start,
    end,
    startDate: '',
    endDate: '',
    isDateBased: false,
    joinUrl,
    rUrl,
    rUrls,
    locations,
    location,
    d,
    geo,
    startTzid,
    endTzid,
    topics
  }
}

/**
 * Drop leading/trailing lines that are only `#word` tokens when every word matches a NIP-52
 * `t` tag (already shown as topic chips). Typical duplicate: body ends with `#run #walk` mirroring `t` tags.
 */
export function stripCalendarEventRedundantTopicHashtagLines(
  content: string,
  topics: readonly string[]
): string {
  const topicSet = new Set(
    topics.map((x) => x.trim().toLowerCase()).filter((x): x is string => x.length > 0)
  )
  if (topicSet.size === 0) return content

  const lines = content.split('\n')

  const isHashtagOnlyLine = (line: string): boolean => {
    const t = line.trim()
    if (!t) return false
    const parts = t.split(/\s+/).filter(Boolean)
    return parts.every((p) => /^#[a-zA-Z0-9_]+$/.test(p))
  }

  const tagsFromHashtagOnlyLine = (line: string): string[] =>
    line
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.slice(1).toLowerCase())

  let start = 0
  let end = lines.length

  while (start < end) {
    const line = lines[start]
    if (line.trim() === '') {
      start++
      continue
    }
    if (!isHashtagOnlyLine(line)) break
    const tags = tagsFromHashtagOnlyLine(line)
    if (!tags.every((tag) => topicSet.has(tag))) break
    start++
  }

  while (end > start) {
    const line = lines[end - 1]
    if (line.trim() === '') {
      end--
      continue
    }
    if (!isHashtagOnlyLine(line)) break
    const tags = tagsFromHashtagOnlyLine(line)
    if (!tags.every((tag) => topicSet.has(tag))) break
    end--
  }

  return lines.slice(start, end).join('\n').trimEnd()
}

const CALENDAR_DISPLAY_LOCALE = 'en-US'

function readFormatParts(
  d: Date,
  opts: Intl.DateTimeFormatOptions
): Record<Intl.DateTimeFormatPartTypes, string> {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const p of new Intl.DateTimeFormat(CALENDAR_DISPLAY_LOCALE, opts).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = p.value
  }
  return out as Record<Intl.DateTimeFormatPartTypes, string>
}

/**
 * Single instant: explicit English month + day + year + 12-hour clock + short timezone
 * (e.g. `May 13, 2025 10:30 am EST`) in the viewer's local zone — avoids DD/MM vs MM/DD ambiguity.
 */
export function formatCalendarTime(ts: number): string {
  const d = new Date(ts * 1000)
  const p = readFormatParts(d, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
  const ap = (p.dayPeriod ?? '').toLowerCase()
  const tz = p.timeZoneName ?? ''
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${ap} ${tz}`.trim()
}

/** `start` / `end` Unix seconds; omits end time if invalid or not after start. Same calendar day → one date line. */
export function formatCalendarTimeRange(start: number, end: number | undefined): string {
  const startLine = formatCalendarTime(start)
  if (end == null || Number.isNaN(end) || end <= start) return startLine

  const a = new Date(start * 1000)
  const b = new Date(end * 1000)
  const sameLocalDay =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (!sameLocalDay) {
    return `${formatCalendarTime(start)} – ${formatCalendarTime(end)}`
  }

  const dateOnly = readFormatParts(a, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  const dateStr = `${dateOnly.month} ${dateOnly.day}, ${dateOnly.year}`

  const pStart = readFormatParts(a, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
  const pEnd = readFormatParts(b, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  const apS = (pStart.dayPeriod ?? '').toLowerCase()
  const apE = (pEnd.dayPeriod ?? '').toLowerCase()
  const tz = pStart.timeZoneName ?? ''
  return `${dateStr} · ${pStart.hour}:${pStart.minute} ${apS} – ${pEnd.hour}:${pEnd.minute} ${apE} ${tz}`.trim()
}

/** Format a YYYY-MM-DD date string for display (English long month, unambiguous). */
export function formatCalendarDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  const p = readFormatParts(d, { month: 'long', day: 'numeric', year: 'numeric' })
  return `${p.month} ${p.day}, ${p.year}`
}

/** Inclusive start and exclusive end (NIP-52); omits end when same as start. */
export function formatCalendarDateRange(startDate: string, endDate: string): string {
  if (!startDate?.trim() && !endDate?.trim()) return ''
  if (!startDate?.trim()) return formatCalendarDate(endDate)
  const a = formatCalendarDate(startDate)
  if (!endDate?.trim() || endDate === startDate) return a
  return `${a} – ${formatCalendarDate(endDate)}`
}

/** Seconds per day for NIP-52 `D` tags: `floor(unix_seconds / 86400)`. */
const NIP52_SECONDS_PER_DAY = 86400

function nip52DayIndexToUtcCalendarParts(dayIndex: number): { month: string; day: string; year: string } {
  const ms = dayIndex * NIP52_SECONDS_PER_DAY * 1000
  const d = new Date(ms)
  const parts = new Intl.DateTimeFormat(CALENDAR_DISPLAY_LOCALE, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).formatToParts(d)
  const m: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  return {
    month: m.month ?? '',
    day: m.day ?? '',
    year: m.year ?? ''
  }
}

/**
 * Human-readable summary of NIP-52 `D` (day-granularity) tags: each value is a UTC calendar day index
 * from the Unix epoch; publishers repeat `D` for every day a timed event touches so relays can index
 * and filter by day. Ranges of consecutive indices are collapsed (e.g. “May 23–25, 2026”).
 */
export function summarizeNip52DayGranularityTags(dayStrings: readonly string[]): string {
  const indices = Array.from(
    new Set(
      dayStrings
        .map((s) => String(s).trim())
        .filter((s) => /^-?\d+$/.test(s))
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    )
  ).sort((a, b) => a - b)
  if (indices.length === 0) return ''

  const ranges: Array<{ start: number; end: number }> = []
  for (const n of indices) {
    const last = ranges[ranges.length - 1]
    if (last && n === last.end + 1) last.end = n
    else ranges.push({ start: n, end: n })
  }

  return ranges
    .map(({ start, end }) => {
      if (start === end) {
        const p = nip52DayIndexToUtcCalendarParts(start)
        return `${p.month} ${p.day}, ${p.year}`
      }
      const a = nip52DayIndexToUtcCalendarParts(start)
      const b = nip52DayIndexToUtcCalendarParts(end)
      if (a.month === b.month && a.year === b.year) {
        return `${a.month} ${a.day}–${b.day}, ${a.year}`
      }
      if (a.year === b.year) {
        return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`
      }
      return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`
    })
    .join(' · ')
}

/** True for NIP-52 calendar note kinds **31922** / **31923** only (via {@link isNip52CalendarCardKind}). */
export function isCalendarEventKind(kind: number): boolean {
  return isNip52CalendarCardKind(kind)
}

/** Local midnight at start of `YYYY-MM-DD`; invalid pattern → null. */
export function parseCalendarYmdToLocalStartMs(ymd: string): number | null {
  const t = ymd?.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ms = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Half-open window [startMs, endExclusiveMs) for overlap with a week
 * [weekStartMs, weekEndExclusiveMs). Date-based uses NIP-52 exclusive `end` date.
 */
export function getCalendarOccurrenceWindowMs(
  event: Event
): { startMs: number; endExclusiveMs: number } | null {
  const m = getCalendarEventMeta(event)
  if (m.isDateBased) {
    const s = m.startDate ? parseCalendarYmdToLocalStartMs(m.startDate) : null
    if (s == null) return null
    if (m.endDate?.trim()) {
      if (m.endDate === m.startDate) {
        return { startMs: s, endExclusiveMs: s + 86400000 }
      }
      const e = parseCalendarYmdToLocalStartMs(m.endDate)
      return { startMs: s, endExclusiveMs: e != null ? e : s + 86400000 }
    }
    return { startMs: s, endExclusiveMs: s + 86400000 }
  }
  if (m.start == null || Number.isNaN(m.start)) return null
  const startMs = m.start * 1000
  const endExclusiveMs =
    m.end != null && !Number.isNaN(m.end) && m.end > m.start ? m.end * 1000 : startMs + 3600000
  return { startMs, endExclusiveMs }
}

export function calendarOccurrenceOverlapsRange(
  event: Event,
  rangeStartMs: number,
  rangeEndExclusiveMs: number
): boolean {
  const w = getCalendarOccurrenceWindowMs(event)
  if (!w) return false
  return w.startMs < rangeEndExclusiveMs && w.endExclusiveMs > rangeStartMs
}

/**
 * Deduplicate by replaceable coordinate; when several revisions exist, prefer one whose occurrence **overlaps**
 * `[rangeStartMs, rangeEndExclusiveMs)` with a parseable window, then newest `created_at`. Avoids global calendar
 * REQs replacing a good local row with a newer revision that does not apply to the visible range.
 */
export function dedupeCalendarEventsPreferringOccurrenceRange(
  events: Event[],
  rangeStartMs: number,
  rangeEndExclusiveMs: number
): Event[] {
  const byKey = new Map<string, Event[]>()
  for (const e of events) {
    const k = replaceableEventDedupeKey(e)
    const list = byKey.get(k)
    if (list) list.push(e)
    else byKey.set(k, [e])
  }
  const out: Event[] = []
  for (const variants of byKey.values()) {
    const inRange = variants.filter(
      (e) =>
        getCalendarOccurrenceWindowMs(e) != null &&
        calendarOccurrenceOverlapsRange(e, rangeStartMs, rangeEndExclusiveMs)
    )
    const pool = inRange.length > 0 ? inRange : variants
    out.push(pool.reduce((best, e) => (e.created_at > best.created_at ? e : best)))
  }
  return out
}

/** Monday 00:00 local through the following Monday 00:00 (exclusive), shifted by `weekOffset` weeks from the anchor week. */
/** Local midnight on the 1st through midnight on the 1st of the following month (exclusive). */
export function getLocalMonthRangeMs(
  year: number,
  monthIndex: number
): { startMs: number; endExclusiveMs: number } {
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0)
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0)
  return { startMs: start.getTime(), endExclusiveMs: end.getTime() }
}

export function getLocalMondayWeekBounds(
  weekOffset: number,
  anchor: Date = new Date()
): { weekStartMs: number; weekEndExclusiveMs: number } {
  const d = new Date(anchor)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diffFromMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diffFromMonday + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { weekStartMs: monday.getTime(), weekEndExclusiveMs: end.getTime() }
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Compact week banner for sidebar (en-US month names). */
export function formatSidebarWeekLabel(weekStartMs: number, weekEndExclusiveMs: number): string {
  const start = new Date(weekStartMs)
  const last = new Date(weekEndExclusiveMs)
  last.setDate(last.getDate() - 1)
  const y1 = start.getFullYear()
  const y2 = last.getFullYear()
  const m1 = start.getMonth()
  const m2 = last.getMonth()
  const d1 = start.getDate()
  const d2 = last.getDate()
  if (y1 === y2 && m1 === m2 && d1 === d2) {
    return formatCalendarDate(toYmdLocal(start))
  }
  const p1 = readFormatParts(start, { month: 'short', day: 'numeric', year: y1 !== y2 ? 'numeric' : undefined })
  const p2 = readFormatParts(last, { month: 'short', day: 'numeric', year: 'numeric' })
  const left =
    y1 !== y2
      ? `${p1.month} ${p1.day}, ${p1.year}`
      : m1 === m2
        ? `${p1.month} ${p1.day}`
        : `${p1.month} ${p1.day}`
  const right = `${p2.month} ${p2.day}, ${p2.year}`
  return `${left} – ${right}`
}

/** One-line schedule hint for narrow sidebar rows (en-US, includes TZ for timed events). */
export function formatCalendarSidebarRow(event: Event): string {
  const m = getCalendarEventMeta(event)
  if (m.isDateBased) {
    if (!m.startDate) return ''
    const a = formatCalendarDate(m.startDate)
    if (m.endDate?.trim() && m.endDate !== m.startDate) {
      return `${a} – ${formatCalendarDate(m.endDate)}`
    }
    return a
  }
  if (m.start == null || Number.isNaN(m.start)) return ''
  const d = new Date(m.start * 1000)
  const p = readFormatParts(d, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
  const ap = (p.dayPeriod ?? '').toLowerCase()
  const base = `${p.month} ${p.day} · ${p.hour}:${p.minute} ${ap} ${p.timeZoneName ?? ''}`.trim()
  if (m.end != null && !Number.isNaN(m.end) && m.end > m.start) {
    const d2 = new Date(m.end * 1000)
    const p2 = readFormatParts(d2, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    const ap2 = (p2.dayPeriod ?? '').toLowerCase()
    return `${base} – ${p2.hour}:${p2.minute} ${ap2}`
  }
  return base
}
