import type { Event, Filter } from 'nostr-tools'

function valuesMatchTag(tagName: string, eventValues: string[], filterValues: unknown[]): boolean {
  if (tagName.toLowerCase() === 't') {
    const allowed = new Set(filterValues.map((v) => String(v).toLowerCase()))
    return eventValues.some((v) => allowed.has(v.toLowerCase()))
  }
  const allowed = new Set(filterValues.map((v) => String(v)))
  return eventValues.some((v) => allowed.has(v))
}

export function eventMatchesLocalFeedFilter(event: Event, filter: Filter): boolean {
  if (Array.isArray(filter.ids) && filter.ids.length > 0 && !filter.ids.includes(event.id)) return false
  if (Array.isArray(filter.authors) && filter.authors.length > 0 && !filter.authors.includes(event.pubkey)) {
    return false
  }
  if (Array.isArray(filter.kinds) && filter.kinds.length > 0 && !filter.kinds.includes(event.kind)) return false
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false

  const search = typeof filter.search === 'string' ? filter.search.trim().toLowerCase() : ''
  if (search) {
    const haystack = `${event.content ?? ''} ${(event.tags ?? []).flat().join(' ')}`.toLowerCase()
    if (!haystack.includes(search)) return false
  }

  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue
    if (!Array.isArray(values) || values.length === 0) continue
    const tagName = key.slice(1)
    const eventValues = event.tags
      .filter((tag) => tag[0] === tagName && typeof tag[1] === 'string')
      .map((tag) => tag[1] as string)
    if (eventValues.length === 0) return false
    if (!valuesMatchTag(tagName, eventValues, values)) return false
  }

  return true
}

export function eventMatchesAnyLocalFeedFilter(event: Event, filters: readonly Filter[]): boolean {
  return filters.some((filter) => eventMatchesLocalFeedFilter(event, filter))
}
