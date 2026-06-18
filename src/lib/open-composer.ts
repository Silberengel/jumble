import { buildComposerNewPostUrl, buildComposerReplyUrl } from '@/lib/composer-navigation'
import type { Event } from 'nostr-tools'

export type OpenComposerParams = {
  defaultContent?: string
  openFrom?: string[]
  initialPublicMessageTo?: string
  parentEvent?: Event
  parentEventId?: string
}

/**
 * Opens the composer: navigates to the full-screen composer page on mobile,
 * returns false so callers can fall back to the PostEditor dialog on desktop.
 */
export function navigateToComposer(
  push: (url: string) => void,
  isSmallScreen: boolean,
  params: OpenComposerParams = {}
): boolean {
  if (!isSmallScreen) return false
  const url = params.parentEvent
    ? buildComposerReplyUrl(params.parentEvent.id, params)
    : params.parentEventId
      ? buildComposerReplyUrl(params.parentEventId, params)
      : buildComposerNewPostUrl(params)
  push(url)
  return true
}

export function composerOptionsPathActive(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname === '/compose/options'
}
