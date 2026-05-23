import { RefreshButton } from '@/components/RefreshButton'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useSecondaryPage, useSmartNoteNavigation } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import ContentPreview from '@/components/ContentPreview'
import client from '@/services/client.service'
import Note from '@/components/Note'
import NoteInteractions from '@/components/NoteInteractions'
import NoteStats from '@/components/NoteStats'
import UserAvatar from '@/components/UserAvatar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useFetchEvent,
  useFetchProfile,
  useFetchThreadContextEvent,
  useNip84HighlightTargetEvents
} from '@/hooks'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNostr } from '@/providers/NostrProvider'
import noteStatsService from '@/services/note-stats.service'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import {
  getParentBech32Id,
  getParentETag,
  getParentEventHexId,
  getRootBech32Id,
  getRootEventHexId,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { stripMarkupForPreview } from '@/lib/parent-reply-blurb'
import { tagNameEquals } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { Ellipsis } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { NOSTR_URI_NADDR_REGEX } from '@/lib/content-patterns'
import {
  applyDefaultSiteSocialMeta,
  avatarProxyUrl,
  defaultOgImageAbsoluteUrl,
  getSiteOrigin,
  removeMetaByProperty,
  SITE_NAME,
  updateMetaTag
} from '@/lib/document-meta'
import NotFound from './NotFound'
import { ThreadProfileBatchProvider } from '@/providers/ThreadProfileBatchProvider'
import { ThreadReplyProvider } from '@/providers/ThreadReplyProvider'

// Helper function to get event type name (matching WebPreview)
function getEventTypeName(kind: number): string {
  switch (kind) {
    case kinds.ShortTextNote:
      return 'Text Post'
    case kinds.LongFormArticle:
      return 'Longform Article'
    case ExtendedKind.PICTURE:
      return 'Picture'
    case ExtendedKind.VIDEO:
    case ExtendedKind.VIDEO_ADDRESSABLE:
      return 'Video'
    case ExtendedKind.SHORT_VIDEO:
      return 'Short Video'
    case ExtendedKind.POLL:
      return 'Poll'
    case ExtendedKind.COMMENT:
      return 'Comment'
    case ExtendedKind.VOICE:
      return 'Voice Post'
    case ExtendedKind.VOICE_COMMENT:
      return 'Voice Comment'
    case kinds.Highlights:
      return 'Highlight'
    case ExtendedKind.PUBLICATION:
      return 'Publication'
    case ExtendedKind.PUBLICATION_CONTENT:
      return 'Publication Content'
    case ExtendedKind.WIKI_ARTICLE:
      return 'Wiki Article'
    case ExtendedKind.NOSTR_SPECIFICATION:
      return 'Nostr Specification'
    case ExtendedKind.DISCUSSION:
      return 'Discussion'
    case ExtendedKind.CALENDAR_EVENT_TIME:
    case ExtendedKind.CALENDAR_EVENT_DATE:
      return 'Calendar Event'
    default:
      return `Event (kind ${kind})`
  }
}

function eventPointerHexId(pointer: string | undefined): string | undefined {
  const raw = pointer?.trim()
  if (!raw) return undefined
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
  try {
    const decoded = nip19.decode(raw)
    if (decoded.type === 'note') return decoded.data.toLowerCase()
    if (decoded.type === 'nevent') return decoded.data.id.toLowerCase()
  } catch {
    /* invalid pointer */
  }
  return undefined
}

function eventPointersReferenceSameNote(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const aHex = eventPointerHexId(a)
  const bHex = eventPointerHexId(b)
  return aHex != null && bHex != null ? aHex === bHex : a === b
}

const NotePage = forwardRef(({ id, index, hideTitlebar = false, initialEvent }: { id?: string; index?: number; hideTitlebar?: boolean; initialEvent?: Event }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { event, isFetching, refetch: refetchMain } = useFetchEvent(id, initialEvent)
  const [externalEvent, setExternalEvent] = useState<Event | undefined>(undefined)
  const [replyRefreshToken, setReplyRefreshToken] = useState(0)
  const finalEvent = event || externalEvent
  const nip84HighlightEvents = useNip84HighlightTargetEvents(finalEvent)
  
  const parentEventId = useMemo(() => {
    if (!finalEvent) return undefined
    const parentHex = getParentEventHexId(finalEvent)?.toLowerCase()
    if (parentHex && parentHex === finalEvent.id.toLowerCase()) return undefined
    return getParentBech32Id(finalEvent)
  }, [finalEvent])
  const rootEventId = useMemo(() => {
    if (!finalEvent) return undefined
    const rootHex = getRootEventHexId(finalEvent)?.toLowerCase()
    const rootBech32Id = getRootBech32Id(finalEvent)
    if (rootHex && /^[0-9a-f]{64}$/i.test(rootHex)) {
      const resolvedRootHex = resolveDeclaredThreadRootEventHex(rootHex)
      if (resolvedRootHex === finalEvent.id.toLowerCase()) return undefined
      return resolvedRootHex === rootHex ? rootBech32Id ?? resolvedRootHex : resolvedRootHex
    }
    return rootBech32Id
  }, [finalEvent])
  const rootITag = useMemo(
    () => (finalEvent?.kind === ExtendedKind.COMMENT ? finalEvent.tags.find(tagNameEquals('I')) : undefined),
    [finalEvent]
  )
  const rootInitialEvent = useMemo(() => {
    if (!finalEvent) return undefined
    const rootHex = getRootEventHexId(finalEvent)?.toLowerCase()
    if (!rootHex || !/^[0-9a-f]{64}$/i.test(rootHex)) return undefined
    const resolved = resolveDeclaredThreadRootEventHex(rootHex)
    return client.peekSessionCachedEvent(resolved) ?? client.peekSessionCachedEvent(rootHex)
  }, [finalEvent])
  const parentInitialEvent = useMemo(() => {
    if (!finalEvent) return undefined
    const parentHex = getParentEventHexId(finalEvent)?.toLowerCase()
    if (!parentHex || !/^[0-9a-f]{64}$/i.test(parentHex)) return undefined
    return client.peekSessionCachedEvent(parentHex)
  }, [finalEvent])
  const { isFetching: isFetchingRootEvent, event: rootEvent, refetch: refetchRoot } =
    useFetchThreadContextEvent(rootEventId, finalEvent, 'root', rootInitialEvent)
  const { isFetching: isFetchingParentEvent, event: parentEvent, refetch: refetchParent } =
    useFetchThreadContextEvent(parentEventId, finalEvent, 'parent', parentInitialEvent)

  const selfHex = finalEvent?.id?.toLowerCase()
  const rootEventForStrip =
    rootEvent && selfHex && rootEvent.id.toLowerCase() !== selfHex ? rootEvent : undefined
  const parentEventForStrip =
    parentEvent && selfHex && parentEvent.id.toLowerCase() !== selfHex ? parentEvent : undefined
  const { pubkey } = useNostr()
  const { relays: statsRelays, currentRelaysKey } = useNoteStatsRelayHints()

  useEffect(() => {
    if (!rootEventForStrip) return
    void noteStatsService.fetchNoteStats(rootEventForStrip, pubkey, statsRelays, { foreground: true })
  }, [rootEventForStrip, pubkey, statsRelays, currentRelaysKey])

  // When viewing a kind-24 invite (e.g. from notifications), extract calendar event naddr from content and show full calendar card with RSVP
  const calendarInviteNaddr = useMemo(() => {
    if (finalEvent?.kind !== ExtendedKind.PUBLIC_MESSAGE || !finalEvent.content?.trim()) return undefined
    const match = NOSTR_URI_NADDR_REGEX.exec(finalEvent.content)
    NOSTR_URI_NADDR_REGEX.lastIndex = 0
    const naddr = match?.[1]
    if (!naddr) return undefined
    try {
      const decoded = nip19.decode(naddr)
      if (decoded.type === 'naddr' && (decoded.data.kind === ExtendedKind.CALENDAR_EVENT_DATE || decoded.data.kind === ExtendedKind.CALENDAR_EVENT_TIME)) {
        return naddr
      }
    } catch {
      // ignore decode errors
    }
    return undefined
  }, [finalEvent?.kind, finalEvent?.content])
  const { event: calendarInviteEvent, refetch: refetchCalendarInvite } = useFetchEvent(calendarInviteNaddr)

  const refreshNoteData = useCallback(() => {
    refetchMain()
    refetchRoot()
    refetchParent()
    refetchCalendarInvite()
    setReplyRefreshToken((n) => n + 1)
  }, [refetchMain, refetchRoot, refetchParent, refetchCalendarInvite])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(refreshNoteData)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, refreshNoteData])

  const titlebarRefreshControls = hideTitlebar ? undefined : <RefreshButton onClick={refreshNoteData} />

  // Fetch profile for author (for OpenGraph metadata)
  const { profile: authorProfile } = useFetchProfile(finalEvent?.pubkey)

  /** Resolve nostr embeds after first paint — avoids competing with thread/profile batch on open. */
  useEffect(() => {
    if (!finalEvent) return
    const run = () => client.prefetchEmbeddedEventsForParents([finalEvent])
    const idleId =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 4_000 })
        : window.setTimeout(run, 400)
    return () => {
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleId as number)
      } else {
        window.clearTimeout(idleId as number)
      }
    }
  }, [finalEvent?.id])

  const getNoteTypeTitle = (kind: number): string => {
    switch (kind) {
      case 1: // kinds.ShortTextNote
        return 'Note: Text Post'
      case 30023: // kinds.LongFormArticle
        return 'Note: Longform Article'
      case 30040: // ExtendedKind.PUBLICATION
        return 'Note: Publication'
      case 30041: // ExtendedKind.PUBLICATION_CONTENT
        return 'Note: Publication Content'
      case 30817: // ExtendedKind.NOSTR_SPECIFICATION
        return 'Note: Nostr Specification'
      case 30818: // ExtendedKind.WIKI_ARTICLE
        return 'Note: Wiki Article'
      case 20: // ExtendedKind.PICTURE
        return 'Note: Picture'
      case 21: // ExtendedKind.VIDEO
      case 34235: // ExtendedKind.VIDEO_ADDRESSABLE (NIP-71)
        return 'Note: Video'
      case 22: // ExtendedKind.SHORT_VIDEO
        return 'Note: Short Video'
      case 11: // ExtendedKind.DISCUSSION
        return 'Discussions'
      case 9802: // kinds.Highlights
        return 'Note: Highlight'
      case 1068: // ExtendedKind.POLL
        return 'Note: Poll'
      case 31987: // ExtendedKind.RELAY_REVIEW
        return 'Note: Relay Review'
      case 31922: // ExtendedKind.CALENDAR_EVENT_DATE
      case 31923: // ExtendedKind.CALENDAR_EVENT_TIME
        return 'Note: Calendar Event'
      case 9735: // ExtendedKind.ZAP_RECEIPT
        return 'Note: Zap Receipt'
      case 9736: // ExtendedKind.MONERO_TIP_DISCLOSURE
      case 1814: // ExtendedKind.MONERO_TIP_RECEIPT
        return 'Note: Monero Tip'
      case 6: // kinds.Repost (Nostr boost)
      case 16: // ExtendedKind.GENERIC_REPOST (NIP-18)
        return 'Note: Boost'
      case 7: // kinds.Reaction
        return 'Note: Reaction'
      case 17: // ExtendedKind.EXTERNAL_REACTION (NIP-25 external)
        return 'Note: Reaction'
      case 1111: // ExtendedKind.COMMENT
        return 'Note: Comment'
      case 1222: // ExtendedKind.VOICE
        return 'Note: Voice Post'
      case 1244: // ExtendedKind.VOICE_COMMENT
        return 'Note: Voice Comment'
      default:
        return 'Note'
    }
  }

  // Get article metadata for OpenGraph tags
  const articleMetadata = useMemo(() => {
    if (!finalEvent) return null
    const articleKinds = [
      kinds.LongFormArticle, // 30023
      ExtendedKind.PUBLICATION, // 30040
      ExtendedKind.PUBLICATION_CONTENT, // 30041
      ExtendedKind.NOSTR_SPECIFICATION, // 30817
      ExtendedKind.WIKI_ARTICLE // 30818
    ]
    if (articleKinds.includes(finalEvent.kind)) {
      return getLongFormArticleMetadataFromEvent(finalEvent)
    }
    return null
  }, [finalEvent])

  // Store title in sessionStorage for primary note view when hideTitlebar is true
  // This must be called before any early returns to follow Rules of Hooks
  useEffect(() => {
    if (hideTitlebar && finalEvent) {
      const title = getNoteTypeTitle(finalEvent.kind)
      sessionStorage.setItem('notePageTitle', title)
      // Trigger a re-render of the primary view title by dispatching a custom event
      window.dispatchEvent(new Event('notePageTitleUpdated'))
    }
  }, [hideTitlebar, finalEvent])

  // Update OpenGraph metadata to match in-app preview cards and site branding
  useEffect(() => {
    if (!finalEvent) {
      applyDefaultSiteSocialMeta()
      removeMetaByProperty('article:tag')
      return
    }

    // Get event metadata matching fallback card format
    const eventMetadata = getLongFormArticleMetadataFromEvent(finalEvent)
    const eventTypeName = getEventTypeName(finalEvent.kind)
    const eventTitle = eventMetadata?.title || eventTypeName
    const eventSummary = eventMetadata?.summary || ''
    
    // Generate content preview (matching fallback card)
    let contentPreview = ''
    if (finalEvent.content) {
      const stripped = stripMarkupForPreview(finalEvent.content)
      contentPreview = stripped.length > 500 ? stripped.substring(0, 500) + '...' : stripped
    }
    
    // Build description matching fallback card: username • event type, title, summary, content preview, URL
    // Always show note-specific info, even if profile isn't loaded yet
    const authorName = authorProfile?.username || ''
    const parts: string[] = []
    
    // Always include event type (this is note-specific)
    if (eventTypeName) {
      parts.push(eventTypeName)
    }
    if (authorName) {
      parts.push(`@${authorName}`)
    }
    
    let ogDescription = ''
    if (parts.length > 0) {
      ogDescription = parts.join(' • ')
    } else {
      // Fallback if nothing available yet
      ogDescription = 'Event'
    }
    
    // Always show title if available (note-specific)
    if (eventTitle && eventTitle !== eventTypeName) {
      ogDescription += (ogDescription ? ' | ' : '') + eventTitle
    }
    
    // Show summary if available (note-specific)
    if (eventSummary) {
      ogDescription += (ogDescription ? ' - ' : '') + eventSummary
    }
    
    // Truncate URL to 150 chars before adding it
    const fullUrl = window.location.href
    const truncatedUrl = fullUrl.length > 150 ? fullUrl.substring(0, 147) + '...' : fullUrl
    
    // Calculate remaining space for content preview (max 300 chars total, leave room for URL)
    const maxDescLength = 300
    const urlPart = ` | ${truncatedUrl}`
    const remainingLength = maxDescLength - (ogDescription.length + urlPart.length)
    
    // Always try to include content preview if available (this is note-specific!)
    if (contentPreview && remainingLength > 20) {
      const truncatedContent = contentPreview.length > remainingLength 
        ? contentPreview.substring(0, remainingLength - 3) + '...' 
        : contentPreview
      ogDescription += (ogDescription ? ' ' : '') + truncatedContent
    }
    
    // Add truncated URL at the end
    ogDescription += (ogDescription ? urlPart : truncatedUrl)
    
    // Ensure we have note-specific content - if description is still too generic, add more event info
    if (!authorName && !eventSummary && !contentPreview && ogDescription.includes('Event') && !ogDescription.includes('|')) {
      // Add at least the event kind or some identifier to make it note-specific
      ogDescription = ogDescription.replace('Event', `${eventTypeName} (kind ${finalEvent.kind})`)
    }

    let image = eventMetadata?.image
    if (!image && authorProfile?.pubkey) {
      image = avatarProxyUrl(authorProfile.pubkey)
    }
    if (!image) {
      image = defaultOgImageAbsoluteUrl()
    }
    
    const tags = eventMetadata?.tags || []
    
    // For articles, use article type; for other events, use website type
    const isArticle = articleMetadata !== null
    const ogType = isArticle ? 'article' : 'website'

    // Enhanced title with profile info
    const ogTitle = authorName
      ? `${eventTitle} · @${authorName} · ${SITE_NAME}`
      : `${eventTitle} · ${SITE_NAME}`

    updateMetaTag('og:title', ogTitle)
    updateMetaTag('og:description', ogDescription)
    updateMetaTag('og:image', image)
    updateMetaTag('og:image:width', '1200')
    updateMetaTag('og:image:height', '630')
    updateMetaTag('og:image:alt', `${eventTitle}${authorName ? ` by @${authorName}` : ''} on ${SITE_NAME}`)
    updateMetaTag('og:type', ogType)
    updateMetaTag('og:url', window.location.href)
    updateMetaTag('og:site_name', SITE_NAME)
    
    // Add profile data - always include if available
    if (authorProfile) {
      if (authorProfile.username) {
        updateMetaTag('profile:username', authorProfile.username)
      }
      if (authorProfile.nip05) {
        updateMetaTag('profile:username', authorProfile.nip05)
      }
    }
    
    // Add author for articles
    if (isArticle && authorName) {
      updateMetaTag('article:author', authorName)
      const authorUrl = `${getSiteOrigin()}/users/${nip19.npubEncode(finalEvent.pubkey)}`
      updateMetaTag('article:author:url', authorUrl)
    }
    
    // Twitter card meta tags
    updateMetaTag('twitter:card', 'summary_large_image')
    updateMetaTag('twitter:title', ogTitle)
    updateMetaTag('twitter:description', ogDescription.length > 200 ? ogDescription.substring(0, 197) + '...' : ogDescription)
    updateMetaTag('twitter:image', image)
    updateMetaTag('twitter:image:alt', `${eventTitle}${authorName ? ` by @${authorName}` : ''} on ${SITE_NAME}`)
    
    removeMetaByProperty('article:tag')

    // Add article-specific tags (one meta tag per tag)
    if (isArticle) {
      tags.forEach(tag => {
        const tagMeta = document.createElement('meta')
        tagMeta.setAttribute('property', 'article:tag')
        tagMeta.setAttribute('content', tag)
        document.head.appendChild(tagMeta)
      })
    }

    document.title = ogTitle

    return () => {
      applyDefaultSiteSocialMeta()
      removeMetaByProperty('article:tag')
      removeMetaByProperty('article:author')
      document.querySelector('meta[property="article:author:url"]')?.remove()
      document.title = SITE_NAME
    }
  }, [finalEvent, articleMetadata, authorProfile])

  if (!event && isFetching) {
    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Note')}
        controls={titlebarRefreshControls}
      >
        <div className="px-4 pt-3">
          <div className="flex items-center space-x-2">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className={`flex-1 w-0`}>
              <div className="py-1">
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="py-0.5">
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
          <div className="pt-2">
            <div className="my-1">
              <Skeleton className="w-full h-4 my-1 mt-2" />
            </div>
            <div className="my-1">
              <Skeleton className="w-2/3 h-4 my-1" />
            </div>
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
  if (!finalEvent) {
    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Note')}
        controls={titlebarRefreshControls}
        displayScrollToTopButton
      >
        <NotFound bech32Id={id} onEventFound={setExternalEvent} />
      </SecondaryPageLayout>
    )
  }

  return (
    <ThreadReplyProvider threadKey={finalEvent.id}>
    <ThreadProfileBatchProvider seedEvents={[finalEvent]}>
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : getNoteTypeTitle(finalEvent.kind)}
      controls={titlebarRefreshControls}
      displayScrollToTopButton
    >
      <div className="px-4 pt-3 w-full">
        {rootITag && <ExternalRoot value={rootITag[1]} />}
        {rootEventId && (
          <ParentNote
            key={`thread-root-${finalEvent.id}`}
            isFetching={isFetchingRootEvent && !rootEventForStrip}
            event={rootEventForStrip}
            eventBech32Id={rootEventId}
            isConsecutive={
              !parentEventId ||
              eventPointersReferenceSameNote(parentEventId, rootEventId) ||
              isConsecutive(rootEventForStrip, parentEventForStrip)
            }
          />
        )}
        {parentEventId &&
          !eventPointersReferenceSameNote(parentEventId, rootEventId) &&
          !eventPointersReferenceSameNote(parentEventId, finalEvent.id) &&
          (parentEventForStrip ? (
            <div key={`parent-note-${parentEventForStrip.id}`} className="mb-3 mt-1">
              {!isConsecutive(rootEventForStrip, parentEventForStrip) ? (
                <Ellipsis className="ml-3.5 mb-1 text-muted-foreground/60 size-3" />
              ) : null}
              <Note event={parentEventForStrip} hideParentNotePreview showFull />
              <div className="ml-5 w-px h-3 bg-border" />
            </div>
          ) : isFetchingParentEvent ? (
            <ThreadContextSkeleton key={`parent-note-skeleton-${finalEvent.id}`} />
          ) : null)}
        {(rootEventForStrip || parentEventForStrip) && <Separator className="my-3" />}
        <Note
          key={`note-${finalEvent.id}`}
          event={finalEvent}
          className="select-text"
          hideParentNotePreview
          originalNoteId={id}
          showFull
          nip84HighlightEvents={nip84HighlightEvents}
          fullCalendarInvite={
            calendarInviteEvent && calendarInviteNaddr
              ? { event: calendarInviteEvent, naddr: calendarInviteNaddr }
              : undefined
          }
        />
        <NoteStats
          className="mt-3"
          event={finalEvent}
          fetchIfNotExisting
          foregroundStats
        />
      </div>
      <Separator className="mt-4" />
      <div className="px-4 pb-12 w-full">
        <NoteInteractions
          key={`note-interactions-${finalEvent.id}`}
          pageIndex={index}
          event={finalEvent}
          statsForeground
          refreshToken={replyRefreshToken}
        />
      </div>
    </SecondaryPageLayout>
    </ThreadProfileBatchProvider>
    </ThreadReplyProvider>
  )
})
NotePage.displayName = 'NotePage'
export default NotePage

function ThreadContextSkeleton() {
  return (
    <div className="mb-3">
      <div className="flex items-center space-x-2">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1 w-0">
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="pt-2 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}

function ExternalRoot({ value }: { value: string }) {
  const { push } = useSecondaryPage()

  return (
    <div>
      <Card
        className="flex space-x-1 px-1.5 py-1 items-center clickable text-sm text-muted-foreground hover:text-foreground"
        onClick={() => {
          // For external content, we still use secondary page navigation
          push(toNoteList({ externalContentId: value }))
        }}
      >
        <div className="truncate">{value}</div>
      </Card>
      <div className="ml-5 w-px h-2 bg-border" />
    </div>
  )
}

function ParentNote({
  event,
  eventBech32Id,
  isFetching,
  isConsecutive = true
}: {
  event?: Event
  eventBech32Id: string
  isFetching: boolean
  isConsecutive?: boolean
}) {
  const { navigateToNote } = useSmartNoteNavigation()
  const navigate = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      if (event) {
        const hex = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : undefined
        client.addEventToCache(event, hex ? { explicitNoteLookupHexId: hex } : undefined)
      }
      navigateToNote(
        toNote(event ?? eventBech32Id),
        event,
        event ? getCachedThreadContextEvents(event) : undefined
      )
    },
    [event, eventBech32Id, navigateToNote]
  )

  if (isFetching) {
    return (
      <div>
        <div className="flex space-x-1 px-[0.4375rem] py-1 items-center rounded-full border clickable text-sm text-muted-foreground">
          <Skeleton className="shrink w-4 h-4 rounded-full" />
          <div className="py-1 flex-1">
            <Skeleton className="h-3" />
          </div>
        </div>
        <div className="ml-5 w-px h-3 bg-border" />
      </div>
    )
  }

  return (
    <div>
      <div
        className={cn(
          'flex space-x-1 px-[0.4375rem] py-1 items-center rounded-full border clickable text-sm text-muted-foreground',
          event && 'hover:text-foreground'
        )}
        onClick={navigate}
      >
        {event && (
          <UserAvatar userId={event.pubkey} size="tiny" className="shrink-0" deferRemoteAvatar={false} />
        )}
        <div 
          className="truncate flex-1"
          onClick={navigate}
        >
          <ContentPreview event={event} />
        </div>
      </div>
      {isConsecutive ? (
        <div className="ml-5 w-px h-3 bg-border" />
      ) : (
        <Ellipsis className="ml-3.5 text-muted-foreground/60 size-3" />
      )}
    </div>
  )
}

function isConsecutive(rootEvent?: Event, parentEvent?: Event) {
  const eTag = getParentETag(parentEvent)
  if (!eTag) return false

  return rootEvent?.id === eTag[1]
}
