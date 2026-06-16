/**
 * Navigation Service
 *
 * Centralized navigation management for the application.
 * Handles all navigation logic in a clean, testable way.
 */

import React, { lazy, ReactNode, Suspense } from 'react'
import NotePageRoute from '@/pages/secondary/NotePage/NotePageRoute'

/** Lazy page chunks — must not static-import the same modules that routes.tsx lazy-loads. */
const SettingsPageLazy = lazy(() => import('@/pages/secondary/SettingsPage'))
const RelaySettingsPageLazy = lazy(() => import('@/pages/secondary/RelaySettingsPage'))
const WalletPageLazy = lazy(() => import('@/pages/secondary/WalletPage'))
const PostSettingsPageLazy = lazy(() => import('@/pages/secondary/PostSettingsPage'))
const GeneralSettingsPageLazy = lazy(() => import('@/pages/secondary/GeneralSettingsPage'))
const RssFeedSettingsPageLazy = lazy(() => import('@/pages/secondary/RssFeedSettingsPage'))
const FollowSetsSettingsPageLazy = lazy(() => import('@/pages/secondary/FollowSetsSettingsPage'))
const EmojiSetsSettingsPageLazy = lazy(() => import('@/pages/secondary/EmojiSetsSettingsPage'))
const CacheSettingsPageLazy = lazy(() => import('@/pages/secondary/CacheSettingsPage'))
const PersonalListsSettingsPageLazy = lazy(() => import('@/pages/secondary/PersonalListsSettingsPage'))
const ProfilePageLazy = lazy(() => import('@/pages/secondary/ProfilePage'))
const FollowingListPageLazy = lazy(() => import('@/pages/secondary/FollowingListPage'))
const FollowersListPageLazy = lazy(() => import('@/pages/secondary/FollowersListPage'))
const MuteListPageLazy = lazy(() => import('@/pages/secondary/MuteListPage'))
const OthersRelaySettingsPageLazy = lazy(() => import('@/pages/secondary/OthersRelaySettingsPage'))
const RelayPageLazy = lazy(() => import('@/pages/secondary/RelayPage'))
const NoteListPageLazy = lazy(() => import('@/pages/secondary/NoteListPage'))

const navLazyFallback = React.createElement(
  'div',
  { className: 'flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground' },
  'Loading…'
)

function navLazyPage(
  Lazy: React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>,
  props: Record<string, unknown>
): ReactNode {
  return React.createElement(
    Suspense,
    { fallback: navLazyFallback },
    React.createElement(Lazy, props)
  )
}

export type ViewType =
  | 'note'
  | 'settings'
  | 'settings-sub'
  | 'profile'
  | 'hashtag'
  | 'relay'
  | 'following'
  | 'followers'
  | 'mute'
  | 'bookmarks'
  | 'pins'
  | 'interests'
  | 'user-emojis'
  | 'profile-badges'
  | 'notification-thread-follow'
  | 'notification-thread-mute'
  | 'others-relay-settings'
  | null

export interface NavigationContext {
  setPrimaryNoteView: (view: ReactNode, type: ViewType) => void
}

export interface NavigationResult {
  component: ReactNode
  viewType: ViewType
}

/**
 * URL parsing utilities
 */
export class URLParser {
  static extractNoteId(url: string): string {
    return url.replace('/notes/', '')
  }

  static extractRelayUrl(url: string): string {
    return decodeURIComponent(url.replace('/relays/', ''))
  }

  static extractProfileId(url: string): string {
    return url.replace('/users/', '')
  }

  static extractHashtag(url: string): string {
    const searchParams = new URLSearchParams(url.split('?')[1] || '')
    return searchParams.get('t') || ''
  }

  static isSettingsSubPage(url: string): boolean {
    return url.startsWith('/settings/') && url !== '/settings'
  }

  static getSettingsSubPageType(url: string): string {
    try {
      const pathOnly = url.split('?')[0].split('#')[0]
      const parts = pathOnly.split('/').filter(Boolean)
      if (parts[0] !== 'settings') return 'general'
      const sub = parts[1] ?? ''
      const known = new Set([
        'general',
        'relays',
        'wallet',
        'posts',
        'rss-feeds',
        'follow-sets',
        'emoji-sets',
        'cache',
        'personal-lists'
      ])
      return known.has(sub) ? sub : 'general'
    } catch {
      return 'general'
    }
  }
}

/**
 * Component factory for creating page components
 */
export class ComponentFactory {
  static createNotePage(noteId: string): ReactNode {
    return React.createElement(NotePageRoute, { id: noteId, index: 0, hideTitlebar: true })
  }

  static createRelayPage(relayUrl: string): ReactNode {
    return navLazyPage(RelayPageLazy, { url: relayUrl, index: 0 })
  }

  static createProfilePage(profileId: string): ReactNode {
    return navLazyPage(ProfilePageLazy, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createHashtagPage(): ReactNode {
    return navLazyPage(NoteListPageLazy, { hideTitlebar: true })
  }

  static createFollowingListPage(profileId: string): ReactNode {
    return navLazyPage(FollowingListPageLazy, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createFollowersListPage(profileId: string): ReactNode {
    return navLazyPage(FollowersListPageLazy, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createMuteListPage(_profileId: string): ReactNode {
    return navLazyPage(MuteListPageLazy, { index: 0, hideTitlebar: true })
  }

  static createOthersRelaySettingsPage(profileId: string): ReactNode {
    return navLazyPage(OthersRelaySettingsPageLazy, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createSettingsPage(): ReactNode {
    return navLazyPage(SettingsPageLazy, { index: 0, hideTitlebar: true })
  }

  static createSettingsSubPage(type: string): ReactNode {
    const shell = { index: 0, hideTitlebar: true as const }
    switch (type) {
      case 'relays':
        return navLazyPage(RelaySettingsPageLazy, shell)
      case 'wallet':
        return navLazyPage(WalletPageLazy, shell)
      case 'posts':
        return navLazyPage(PostSettingsPageLazy, shell)
      case 'general':
        return navLazyPage(GeneralSettingsPageLazy, shell)
      case 'rss-feeds':
        return navLazyPage(RssFeedSettingsPageLazy, shell)
      case 'follow-sets':
        return navLazyPage(FollowSetsSettingsPageLazy, shell)
      case 'emoji-sets':
        return navLazyPage(EmojiSetsSettingsPageLazy, shell)
      case 'cache':
        return navLazyPage(CacheSettingsPageLazy, shell)
      case 'personal-lists':
        return navLazyPage(PersonalListsSettingsPageLazy, shell)
      default:
        return navLazyPage(GeneralSettingsPageLazy, shell)
    }
  }
}

/**
 * Main navigation service
 */
export class NavigationService {
  private context: NavigationContext

  constructor(context: NavigationContext) {
    this.context = context
  }

  /**
   * Navigate to a note
   */
  navigateToNote(url: string): void {
    const noteId = URLParser.extractNoteId(url)
    const component = ComponentFactory.createNotePage(noteId)
    this.updateHistoryAndView(url, component, 'note')
  }

  /**
   * Navigate to a relay
   */
  navigateToRelay(url: string): void {
    const relayUrl = URLParser.extractRelayUrl(url)
    const component = ComponentFactory.createRelayPage(relayUrl)
    this.updateHistoryAndView(url, component, 'relay')
  }

  /**
   * Navigate to a profile
   */
  navigateToProfile(url: string): void {
    const profileId = URLParser.extractProfileId(url)
    const component = ComponentFactory.createProfilePage(profileId)
    this.updateHistoryAndView(url, component, 'profile')
  }

  /**
   * Navigate to a hashtag page
   */
  navigateToHashtag(url: string): void {
    const component = ComponentFactory.createHashtagPage()
    this.updateHistoryAndView(url, component, 'hashtag')
  }

  /**
   * Navigate to following list
   */
  navigateToFollowingList(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/following', ''))
    const component = ComponentFactory.createFollowingListPage(profileId)
    this.updateHistoryAndView(url, component, 'following')
  }

  /**
   * Navigate to followers list (Nostr Archives)
   */
  navigateToFollowersList(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/followers', ''))
    const component = ComponentFactory.createFollowersListPage(profileId)
    this.updateHistoryAndView(url, component, 'followers')
  }

  /**
   * Navigate to mute list
   */
  navigateToMuteList(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/muted', ''))
    const component = ComponentFactory.createMuteListPage(profileId)
    this.updateHistoryAndView(url, component, 'mute')
  }

  /**
   * Navigate to others relay settings
   */
  navigateToOthersRelaySettings(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/relays', ''))
    const component = ComponentFactory.createOthersRelaySettingsPage(profileId)
    this.updateHistoryAndView(url, component, 'others-relay-settings')
  }

  /**
   * Navigate to settings
   */
  navigateToSettings(url: string): void {
    if (URLParser.isSettingsSubPage(url)) {
      const subPageType = URLParser.getSettingsSubPageType(url)
      const component = ComponentFactory.createSettingsSubPage(subPageType)
      this.updateHistoryAndView(url, component, 'settings-sub')
    } else {
      const component = ComponentFactory.createSettingsPage()
      this.updateHistoryAndView(url, component, 'settings')
    }
  }

  /**
   * Get page title based on view type and URL
   */
  getPageTitle(viewType: ViewType, pathname: string): string {
    if (viewType === 'settings') return 'Settings'
    if (viewType === 'settings-sub') {
      if (pathname.includes('/general')) return 'General Settings'
      if (pathname.includes('/relays')) return 'Relays and Storage Settings'
      if (pathname.includes('/cache')) return 'Cache & offline storage'
      if (pathname.includes('/wallet')) return 'Wallet Settings'
      if (pathname.includes('/posts')) return 'Post Settings'
      if (pathname.includes('/emoji-sets')) return 'Emoji sets'
      return 'Settings'
    }
    if (viewType === 'profile') {
      if (pathname.includes('/following')) return 'Following'
      if (pathname.includes('/followers')) return 'Followers'
      if (pathname.includes('/relays')) return 'Relays and Storage Settings'
      return 'Profile'
    }
    if (viewType === 'hashtag') return 'Hashtag'
    if (viewType === 'relay') return 'Relay'
    if (viewType === 'note') {
      // Try to get title from sessionStorage if NotePage has set it
      // NotePage will store the title when it determines the event kind
      const storedTitle = sessionStorage.getItem('notePageTitle')
      if (storedTitle) {
        sessionStorage.removeItem('notePageTitle') // Clean up after use
        return storedTitle
      }
      return 'Note'
    }
    if (viewType === 'following') return 'Following'
    if (viewType === 'followers') return 'Followers'
    if (viewType === 'mute') return 'Muted Users'
    if (viewType === 'bookmarks') return 'Bookmarks'
    if (viewType === 'notification-thread-follow') return 'Thread notifications (follow)'
    if (viewType === 'notification-thread-mute') return 'Thread notifications (mute)'
    if (viewType === 'pins') return 'Pinned notes'
    if (viewType === 'interests') return 'Interests'
    if (viewType === 'user-emojis') return 'Custom emoji list'
    if (viewType === 'profile-badges') return 'Profile badges'
    if (viewType === 'others-relay-settings') return 'Relays and Storage Settings'
    return 'Page'
  }

  /**
   * Handle back navigation
   */
  handleBackNavigation(viewType: ViewType): void {
    if (viewType === 'settings-sub') {
      // Navigate back to main settings page
      this.navigateToSettings('/settings')
    } else {
      // Use browser's back functionality
      window.history.back()
    }
  }

  /**
   * Private helper to update history and view
   */
  private updateHistoryAndView(url: string, component: ReactNode, viewType: ViewType): void {
    window.history.pushState(null, '', url)
    this.context.setPrimaryNoteView(component, viewType)
  }
}

/**
 * Hook factory for creating navigation hooks
 */
export function createNavigationHook(service: NavigationService) {
  return {
    useSmartNoteNavigation: () => ({
      navigateToNote: (url: string) => service.navigateToNote(url)
    }),

    useSmartRelayNavigation: () => ({
      navigateToRelay: (url: string) => service.navigateToRelay(url)
    }),

    useSmartProfileNavigation: () => ({
      navigateToProfile: (url: string) => service.navigateToProfile(url)
    }),

    useSmartHashtagNavigation: () => ({
      navigateToHashtag: (url: string) => service.navigateToHashtag(url)
    }),

    useSmartFollowingListNavigation: () => ({
      navigateToFollowingList: (url: string) => service.navigateToFollowingList(url)
    }),

    useSmartFollowersListNavigation: () => ({
      navigateToFollowersList: (url: string) => service.navigateToFollowersList(url)
    }),

    useSmartMuteListNavigation: () => ({
      navigateToMuteList: (url: string) => service.navigateToMuteList(url)
    }),

    useSmartOthersRelaySettingsNavigation: () => ({
      navigateToOthersRelaySettings: (url: string) => service.navigateToOthersRelaySettings(url)
    }),

    useSmartSettingsNavigation: () => ({
      navigateToSettings: (url: string) => service.navigateToSettings(url)
    })
  }
}
