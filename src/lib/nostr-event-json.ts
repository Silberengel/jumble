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

/**
 * Some clients append a full serialized event after quote/repost text. Treat a trailing event JSON
 * object as structured data instead of showing it as prose.
 */
export function findTrailingStringifiedNostrEvent(content: string): StringifiedNostrEventMatch | null {
  const trimmed = content.trimEnd()
  if (!trimmed) return null

  const whole = parseNostrEventJson(trimmed)
  if (whole) {
    return {
      event: whole,
      textBefore: '',
      jsonText: trimmed
    }
  }

  let start = trimmed.lastIndexOf('{')
  while (start >= 0) {
    const jsonText = trimmed.slice(start)
    const event = parseNostrEventJson(jsonText)
    if (event) {
      return {
        event,
        textBefore: trimmed.slice(0, start).trimEnd(),
        jsonText
      }
    }
    start = trimmed.lastIndexOf('{', start - 1)
  }

  return null
}

export function stripTrailingStringifiedNostrEvent(content: string): string {
  return findTrailingStringifiedNostrEvent(content)?.textBefore ?? content
}
