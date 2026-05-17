import { isLikelyCachedNostrEvent } from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { validateEvent, verifyEvent } from 'nostr-tools'

/** Max size for a pasted JSON blob (single event or small array). */
export const CACHE_IMPORT_MAX_PASTE_CHARS = 400_000

/** Max `.jsonl` upload size. */
export const CACHE_IMPORT_MAX_JSONL_FILE_BYTES = 2 * 1024 * 1024

/** Max lines processed from a `.jsonl` file. */
export const CACHE_IMPORT_MAX_JSONL_LINES = 500

/** Skip oversized single lines in JSONL. */
export const CACHE_IMPORT_MAX_JSONL_LINE_CHARS = 256_000

export type CacheImportParseIssue = { line?: number; message: string }

export type CacheImportParseResult = {
  events: Event[]
  issues: CacheImportParseIssue[]
}

function normalizeImportedEvent(raw: unknown): Event | null {
  if (!isLikelyCachedNostrEvent(raw)) return null
  const ev = raw as Event
  if (typeof ev.created_at !== 'number' || !Number.isFinite(ev.created_at)) return null
  if (typeof ev.sig !== 'string' || !ev.sig.trim()) return null
  if (!validateEvent(ev)) return null
  if (!verifyEvent(ev)) return null
  return ev
}

function collectFromUnknown(
  value: unknown,
  line: number | undefined,
  events: Event[],
  issues: CacheImportParseIssue[]
): void {
  if (Array.isArray(value)) {
    if (value.length + events.length > CACHE_IMPORT_MAX_JSONL_LINES) {
      issues.push({
        line,
        message: `Too many events (max ${CACHE_IMPORT_MAX_JSONL_LINES})`
      })
      return
    }
    for (let i = 0; i < value.length; i++) {
      collectFromUnknown(value[i], line, events, issues)
      if (events.length >= CACHE_IMPORT_MAX_JSONL_LINES) break
    }
    return
  }
  const ev = normalizeImportedEvent(value)
  if (ev) {
    events.push(ev)
    return
  }
  issues.push({
    line,
    message: line != null ? 'Invalid or unsigned event on this line' : 'Invalid or unsigned Nostr event JSON'
  })
}

/** Parse one pasted JSON value (object or array of events). */
export function parsePastedCacheImportJson(text: string): CacheImportParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { events: [], issues: [{ message: 'Paste is empty' }] }
  }
  if (trimmed.length > CACHE_IMPORT_MAX_PASTE_CHARS) {
    return {
      events: [],
      issues: [
        {
          message: `Paste exceeds ${Math.round(CACHE_IMPORT_MAX_PASTE_CHARS / 1024)} KB limit`
        }
      ]
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return { events: [], issues: [{ message: 'Invalid JSON' }] }
  }
  const events: Event[] = []
  const issues: CacheImportParseIssue[] = []
  collectFromUnknown(parsed, undefined, events, issues)
  return { events, issues }
}

/** Parse newline-delimited JSON (one event per line). */
export function parseJsonlCacheImportText(text: string): CacheImportParseResult {
  if (text.length > CACHE_IMPORT_MAX_JSONL_FILE_BYTES) {
    return {
      events: [],
      issues: [
        {
          message: `File content exceeds ${Math.round(CACHE_IMPORT_MAX_JSONL_FILE_BYTES / (1024 * 1024))} MB limit`
        }
      ]
    }
  }
  const lines = text.split(/\r?\n/)
  const events: Event[] = []
  const issues: CacheImportParseIssue[] = []
  let nonEmptyLines = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    nonEmptyLines++
    if (nonEmptyLines > CACHE_IMPORT_MAX_JSONL_LINES) {
      issues.push({
        line: i + 1,
        message: `Stopped at ${CACHE_IMPORT_MAX_JSONL_LINES} events (file has more lines)`
      })
      break
    }
    if (line.length > CACHE_IMPORT_MAX_JSONL_LINE_CHARS) {
      issues.push({ line: i + 1, message: 'Line too large' })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      issues.push({ line: i + 1, message: 'Invalid JSON on this line' })
      continue
    }
    const before = events.length
    collectFromUnknown(parsed, i + 1, events, issues)
    if (events.length === before && issues[issues.length - 1]?.line !== i + 1) {
      issues.push({ line: i + 1, message: 'Invalid or unsigned event on this line' })
    }
    if (events.length >= CACHE_IMPORT_MAX_JSONL_LINES) break
  }
  if (nonEmptyLines === 0) {
    issues.push({ message: 'File has no event lines' })
  }
  return { events, issues }
}

export function formatCacheImportLimits(): string {
  const mb = Math.round(CACHE_IMPORT_MAX_JSONL_FILE_BYTES / (1024 * 1024))
  const pasteKb = Math.round(CACHE_IMPORT_MAX_PASTE_CHARS / 1024)
  return `${CACHE_IMPORT_MAX_JSONL_LINES} events max · ${mb} MB file · ${pasteKb} KB paste`
}
