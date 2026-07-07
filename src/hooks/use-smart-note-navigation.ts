import { usePrimaryPage, usePrimaryPageOptional } from '@/contexts/primary-page-context'
import { useSecondaryPage, useSecondaryPageOptional } from '@/contexts/secondary-page-context'
import { buildNoteUrl, parseNoteUrl } from '@/lib/note-navigation-url'
import { primeNoteNavigationCache } from '@/lib/prime-note-navigation-cache'
import logger from '@/lib/logger'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import type { Event } from 'nostr-tools'

/** Note navigation: full-screen stack on mobile, side panel on desktop. */
export function useSmartNoteNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { current: currentPrimaryPage } = usePrimaryPage()

  const navigateToNote = async (url: string, event?: Event, relatedEvents?: Event[]) => {
    const parsed = parseNoteUrl(url)
    if (!parsed) {
      logger.warn('navigateToNote ignored invalid note URL', { url })
      return
    }
    const { noteId } = parsed

    primeNoteNavigationCache(noteId, event, relatedEvents)

    const contextualUrl = buildNoteUrl(noteId, currentPrimaryPage)
    pushSecondaryPage(contextualUrl)
  }

  return { navigateToNote }
}

/**
 * Safe variant for feed cards and embedded trees. Imports only shared context modules
 * (not PageManager) so Vite HMR does not duplicate SecondaryPageContext providers.
 */
export function useSmartNoteNavigationOptional() {
  const pushSecondaryPage = useSecondaryPageOptional()
  const screenSize = useScreenSizeOptional()
  const primaryPage = usePrimaryPageOptional()

  if (!pushSecondaryPage || !screenSize || !primaryPage) {
    return {
      navigateToNote: (url: string, _event?: Event, _relatedEvents?: Event[]) => {
        window.location.href = url
      }
    }
  }

  const { push } = pushSecondaryPage
  const { current: currentPrimaryPage } = primaryPage

  const navigateToNote = async (url: string, event?: Event, relatedEvents?: Event[]) => {
    const parsed = parseNoteUrl(url)
    if (!parsed) {
      logger.warn('navigateToNote (optional) ignored invalid note URL', { url })
      return
    }
    const { noteId } = parsed
    primeNoteNavigationCache(noteId, event, relatedEvents)
    const contextualUrl = buildNoteUrl(noteId, currentPrimaryPage)
    push(contextualUrl)
  }
  return { navigateToNote }
}
