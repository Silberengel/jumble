/**
 * Utilities for nostr.build media URLs.
 *
 * Thumbnails at `/thumb/<path>` are served on **i.nostr.build** only. Other hosts
 * (e.g. **cdn.nostr.build**) do not provide that route — never rewrite those URLs.
 *
 * The /thumb/ route is for **images** only — never apply it to video URLs.
 */

import { isVideo } from './url'

const I_NOSTR_BUILD = 'i.nostr.build'

/** Returns true when a URL is hosted on any nostr.build domain. */
export function isNostrBuildUrl(url: string): boolean {
  const u = (url ?? '').trim()
  if (!u) return false
  try {
    return new URL(u).hostname.endsWith('nostr.build')
  } catch {
    return false
  }
}

/**
 * True when we may rewrite `url` to i.nostr.build’s `/thumb/…` variant.
 * Only **i.nostr.build** serves generated thumbs; cdn.nostr.build does not.
 */
export function canUseNostrBuildThumb(url: string): boolean {
  const u = (url ?? '').trim()
  if (!u) return false
  if (isVideo(u)) return false
  try {
    const parsed = new URL(u)
    if (parsed.hostname !== I_NOSTR_BUILD) return false
    const p = parsed.pathname
    return p !== '/thumb' && !p.startsWith('/thumb/')
  } catch {
    return false
  }
}

/**
 * Returns the i.nostr.build thumbnail URL for `url` (insert `/thumb` before the path).
 * Returns `url` unchanged if not on i.nostr.build, already under /thumb/, or invalid.
 */
export function toNostrBuildThumbUrl(url: string): string {
  const u = (url ?? '').trim()
  if (!canUseNostrBuildThumb(u)) return u
  try {
    const parsed = new URL(u)
    const p = parsed.pathname || '/'
    parsed.pathname = '/thumb' + (p.startsWith('/') ? p : `/${p}`)
    return parsed.toString()
  } catch {
    return u
  }
}
