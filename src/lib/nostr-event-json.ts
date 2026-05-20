import type { Event } from 'nostr-tools'

const HEX_64_RE = /^[0-9a-f]{64}$/i
const HEX_SIG_RE = /^[0-9a-f]{128}$/i

export type StringifiedNostrEventMatch = {
  event: Event
  textBefore: string
  jsonText: string
}

function isStringArrayArray(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
  )
}

export function isNostrEventJson(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<Event>
  return (
    typeof event.id === 'string' &&
    HEX_64_RE.test(event.id) &&
    typeof event.pubkey === 'string' &&
    HEX_64_RE.test(event.pubkey) &&
    typeof event.created_at === 'number' &&
    Number.isFinite(event.created_at) &&
    typeof event.kind === 'number' &&
    Number.isFinite(event.kind) &&
    isStringArrayArray(event.tags) &&
    typeof event.content === 'string' &&
    typeof event.sig === 'string' &&
    HEX_SIG_RE.test(event.sig)
  )
}

function parseNostrEventJson(raw: string): Event | null {
  try {
    const parsed = JSON.parse(raw)
    return isNostrEventJson(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Only scan the tail — trailing serialized events are never megabytes into the body. */
const MAX_TRAILING_SCAN_LEN = 256 * 1024
/** Profile metadata and prose can contain many `{`; cap work per call. */
const MAX_BRACE_ITERATIONS = 64

/**
 * Some clients append a full serialized event after quote/repost text. Treat a trailing event JSON
 * object as structured data instead of showing it as prose.
 */
export function findTrailingStringifiedNostrEvent(content: string): StringifiedNostrEventMatch | null {
  const trimmed = content.trimEnd()
  if (!trimmed || !trimmed.endsWith('}')) return null

  const windowStart = Math.max(0, trimmed.length - MAX_TRAILING_SCAN_LEN)
  const window = trimmed.slice(windowStart)
  const windowOffset = windowStart

  const whole = parseNostrEventJson(window)
  if (whole) {
    return {
      event: whole,
      textBefore: trimmed.slice(0, windowOffset).trimEnd(),
      jsonText: window
    }
  }

  let start = window.lastIndexOf('{')
  let iterations = 0
  while (start >= 0 && iterations < MAX_BRACE_ITERATIONS) {
    iterations += 1
    const jsonText = window.slice(start)
    const event = parseNostrEventJson(jsonText)
    if (event) {
      const absStart = windowOffset + start
      return {
        event,
        textBefore: trimmed.slice(0, absStart).trimEnd(),
        jsonText
      }
    }
    start = window.lastIndexOf('{', start - 1)
  }

  return null
}

export function stripTrailingStringifiedNostrEvent(content: string): string {
  return findTrailingStringifiedNostrEvent(content)?.textBefore ?? content
}
