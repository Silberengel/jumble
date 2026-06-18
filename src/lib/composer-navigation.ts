import type { Event } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

export const COMPOSER_PATH = '/compose'
export const COMPOSER_REPLY_PATH_PREFIX = '/compose/reply/'
export const COMPOSER_OPTIONS_PATH = '/compose/options'

export type ComposerNavigationParams = {
  defaultContent?: string
  openFrom?: string[]
  initialPublicMessageTo?: string
  parentEvent?: Event
  parentEventId?: string
}

export function buildComposerUrl(params: ComposerNavigationParams = {}): string {
  if (params.parentEvent) {
    return buildComposerReplyUrl(params.parentEvent.id, params)
  }
  if (params.parentEventId) {
    return buildComposerReplyUrl(params.parentEventId, params)
  }
  return buildComposerNewPostUrl(params)
}

export function buildComposerNewPostUrl(params: Omit<ComposerNavigationParams, 'parentEvent' | 'parentEventId'> = {}): string {
  const search = new URLSearchParams()
  if (params.defaultContent?.trim()) search.set('text', params.defaultContent.trim())
  if (params.openFrom?.length) search.set('from', params.openFrom.join(','))
  if (params.initialPublicMessageTo?.trim()) {
    search.set('pm', params.initialPublicMessageTo.trim())
  }
  const q = search.toString()
  return q ? `${COMPOSER_PATH}?${q}` : COMPOSER_PATH
}

export function buildComposerReplyUrl(
  eventId: string,
  params: Omit<ComposerNavigationParams, 'parentEvent' | 'parentEventId'> = {}
): string {
  const id = eventId.trim()
  let segment = id
  if (/^[0-9a-f]{64}$/i.test(id)) {
    try {
      segment = nip19.neventEncode({ id: id.toLowerCase() })
    } catch {
      segment = id.toLowerCase()
    }
  }
  const search = new URLSearchParams()
  if (params.defaultContent?.trim()) search.set('text', params.defaultContent.trim())
  if (params.openFrom?.length) search.set('from', params.openFrom.join(','))
  const q = search.toString()
  const base = `${COMPOSER_REPLY_PATH_PREFIX}${encodeURIComponent(segment)}`
  return q ? `${base}?${q}` : base
}

export function buildComposerOptionsUrl(returnTo?: string): string {
  if (!returnTo?.trim()) return COMPOSER_OPTIONS_PATH
  return `${COMPOSER_OPTIONS_PATH}?return=${encodeURIComponent(returnTo.trim())}`
}

export function parseComposerSearchParams(search: string): {
  defaultContent?: string
  openFrom?: string[]
  initialPublicMessageTo?: string
  returnTo?: string
} {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const from = sp.get('from')
  return {
    defaultContent: sp.get('text') ?? undefined,
    openFrom: from ? from.split(',').filter(Boolean) : undefined,
    initialPublicMessageTo: sp.get('pm') ?? undefined,
    returnTo: sp.get('return') ?? undefined
  }
}

export function decodeComposerReplySegment(segment: string): string {
  const raw = decodeURIComponent(segment.trim())
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
  try {
    const { type, data } = nip19.decode(raw)
    if (type === 'note') return data
    if (type === 'nevent') return data.id
  } catch {
    /* fall through */
  }
  return raw
}
