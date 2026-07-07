import { getEventTypeName } from '@/lib/content/event-type-name'
import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { ExtendedKind } from '@/constants'
import { getLongFormArticleMetadataFromEvent, dTagToTitleCase } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { Skeleton } from '@/components/ui/skeleton'
import { ExternalLink } from 'lucide-react'
import { nip19, type Event } from 'nostr-tools'
import { useMemo, useEffect, useState } from 'react'
import Image from '../Image'
import Username from '../Username'
import { resolveImwaldRouteSocialCopy } from '@/lib/document-meta'
import { hasUsableOpenGraphMetadata } from '@/lib/open-graph-preview'
import { cleanUrl, isSafeMediaUrl } from '@/lib/url'
import { tagNameEquals } from '@/lib/tag'
import { queryService } from '@/services/client.service'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import MarkdownArticle from '../Note/LazyMarkdownArticle'
import AsciidocArticle from '../Note/LazyAsciidocArticle'
import ProfileAbout from '@/components/ProfileAbout'
import ArticleHeroCard, {
  ARTICLE_HERO_ASPECT,
  ARTICLE_HERO_COVER_DIM,
  ARTICLE_HERO_IMAGE_CLASS,
  ARTICLE_HERO_IMAGE_WRAPPER_CLASS,
  isArticleHeroCardKind
} from '../Note/ArticleHeroCard'

/** Scales with Settings → font size via `--content-font-size` (see index.css). */
const WEB_PREVIEW_CARD = 'web-preview-card'

function OpenGraphHeroCard({
  cleanedUrl,
  url,
  hostname,
  title,
  description,
  image,
  className
}: {
  cleanedUrl: string
  url: string
  hostname: string
  title?: string | null
  description?: string | null
  image?: string | null
  className?: string
}) {
  const hasImage = Boolean(image && isSafeMediaUrl(image))
  const onImage = hasImage

  return (
    <div
      className={cn(
        WEB_PREVIEW_CARD,
        'relative w-full border rounded-lg overflow-hidden max-w-full',
        hasImage ? ARTICLE_HERO_ASPECT : 'bg-card',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {hasImage && (
        <>
          <Image
            image={{ url: image!, dim: ARTICLE_HERO_COVER_DIM }}
            className={ARTICLE_HERO_IMAGE_CLASS}
            classNames={{ wrapper: ARTICLE_HERO_IMAGE_WRAPPER_CLASS }}
            hideIfError
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/15"
            aria-hidden
          />
        </>
      )}
      <div
        className={cn(
          'relative z-[1] flex min-h-0 min-w-0 flex-col justify-end p-3',
          onImage && 'absolute inset-0'
        )}
      >
        <div className="mb-0.5 flex min-w-0 items-center gap-2">
          <div
            className={cn(
              'web-preview-muted min-w-0 flex-1 truncate',
              onImage ? 'text-white/75' : 'text-muted-foreground'
            )}
          >
            {hostname}
          </div>
          <a
            href={cleanedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="relative z-[2] shrink-0"
          >
            <ExternalLink className={cn('h-3 w-3', onImage ? 'text-white/90' : 'text-muted-foreground')} />
          </a>
        </div>
        {title && (
          <div
            className={cn(
              'web-preview-title mb-0.5 line-clamp-2 break-words font-semibold',
              onImage ? 'text-white' : undefined
            )}
          >
            {title}
          </div>
        )}
        {description && (
          <div
            className={cn(
              'line-clamp-2 break-words',
              onImage
                ? 'web-preview-muted text-white/85'
                : title
                  ? 'web-preview-muted text-muted-foreground'
                  : 'web-preview-title font-semibold'
            )}
          >
            {description}
          </div>
        )}
        {!title && !description && (
          <div className={cn('web-preview-muted', onImage ? 'text-white/80' : 'text-muted-foreground')}>
            No description available
          </div>
        )}
        <a
          href={cleanedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'web-preview-muted mt-2 line-clamp-1 break-all hover:underline underline-offset-2',
            onImage
              ? 'text-white/70 hover:text-white'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {url}
        </a>
      </div>
    </div>
  )
}

function extractFirstHeader(content: string): string | null {
  if (!content) return null
  
  // Try AsciiDoc header (= or ==)
  const asciidocHeaderMatch = content.match(/^=+\s+(.+)$/m)
  if (asciidocHeaderMatch) {
    return asciidocHeaderMatch[1].trim()
  }
  
  // Try Markdown header (#)
  const markdownHeaderMatch = content.match(/^#+\s+(.+)$/m)
  if (markdownHeaderMatch) {
    return markdownHeaderMatch[1].trim()
  }
  
  // Try setext header (underlined with === or ---)
  const setextMatch = content.match(/^(.+)\n[=]+$/m) || content.match(/^(.+)\n[-]+$/m)
  if (setextMatch) {
    return setextMatch[1].trim()
  }
  
  return null
}

// Helper function to extract first line of content
function extractFirstLine(content: string): string | null {
  if (!content) return null
  
  const firstLine = content.split('\n')[0]?.trim()
  return firstLine || null
}

// Helper function to get title with fallbacks
function getTitleWithFallbacks(event: Event | null, eventMetadata: { title?: string; summary?: string } | null): string | null {
  if (!event) return null
  
  // Get d-tag for comparison
  const dTag = event.tags.find(tag => tag[0] === 'd')?.[1]
  
  // 1. Title tag - but if it matches the d-tag, convert to title case
  if (eventMetadata?.title) {
    // If title exactly matches d-tag (case-insensitive), convert to title case
    if (dTag && eventMetadata.title.toLowerCase() === dTag.toLowerCase()) {
      return dTagToTitleCase(dTag)
    }
    return eventMetadata.title
  }
  
  // 2. d-tag in title case
  if (dTag) {
    return dTagToTitleCase(dTag)
  }
  
  // 3. First header from content
  const firstHeader = extractFirstHeader(event.content)
  if (firstHeader) {
    return firstHeader
  }
  
  // 4. First line of content
  const firstLine = extractFirstLine(event.content)
  if (firstLine) {
    return firstLine
  }
  
  return null
}

export default function WebPreview({
  url,
  className,
  authorPubkey,
  sourceEvent,
  prefetchedOpenGraph
}: {
  url: string
  className?: string
  authorPubkey?: string | null
  /** Note being rendered; content-warning tags block OG/image autoload. */
  sourceEvent?: Event | null
  /** Skip OG fetch/loading when caller already resolved metadata (e.g. {@link HttpUrlOpenGraphOrLink}). */
  prefetchedOpenGraph?: { title?: string; description?: string; image?: string }
}) {
  const autoLoadMedia = useShouldAutoLoadMedia(authorPubkey, sourceEvent)

  const cleanedUrl = useMemo(() => cleanUrl(url), [url])
  /** Link cards and URLs in highlights stay visible on cellular; OG fetch is gated by the same policy as heavy media. */
  const fetchedMetadata = useFetchWebMetadata(cleanedUrl, {
    fetchEnabled: autoLoadMedia && !prefetchedOpenGraph
  })
  const title = prefetchedOpenGraph?.title ?? fetchedMetadata.title
  const description = prefetchedOpenGraph?.description ?? fetchedMetadata.description
  const image = prefetchedOpenGraph?.image ?? fetchedMetadata.image
  const ogLoading = prefetchedOpenGraph ? false : fetchedMetadata.ogLoading

  const hostname = useMemo(() => {
    try {
      return new URL(cleanedUrl).hostname
    } catch {
      return ''
    }
  }, [cleanedUrl])

  const isInternalAppLink = useMemo(() => hostname === 'jumble.imwald.eu', [hostname])

  // Extract replaceable event info (d-tag and pubkey) from URL patterns
  // This is separate from nostrIdentifier to allow fetching without kind
  const replaceableEventInfo = useMemo(() => {
    try {
      // Pattern 1: d-tag*npub format
      const dtagNpubMatch = cleanedUrl.match(/([^\/\?\#\&\*]+)\*(npub1[a-z0-9]{58})/i)
      if (dtagNpubMatch) {
        const dTag = dtagNpubMatch[1].split('/').pop() || dtagNpubMatch[1]
        const npub = dtagNpubMatch[2]
        try {
          const decoded = nip19.decode(npub)
          if (decoded.type === 'npub') {
            return { dTag, pubkey: decoded.data }
          }
        } catch {}
      }
      
      // Pattern 2: d-tag*hexpubkey format
      const dtagHexMatch = cleanedUrl.match(/([^\/\?\#\&\*]+)\*([a-f0-9]{64})/i)
      if (dtagHexMatch) {
        const dTag = dtagHexMatch[1].split('/').pop() || dtagHexMatch[1]
        const hexPubkey = dtagHexMatch[2]
        return { dTag, pubkey: hexPubkey }
      }
      
      // Pattern 3: d-tag/npub format
      const dtagSlashNpubMatch = cleanedUrl.match(/([^\/\?\#\&]+)\/(npub1[a-z0-9]{58})/i)
      if (dtagSlashNpubMatch) {
        const dTag = dtagSlashNpubMatch[1].split('/').pop() || dtagSlashNpubMatch[1]
        const npub = dtagSlashNpubMatch[2]
        try {
          const decoded = nip19.decode(npub)
          if (decoded.type === 'npub') {
            return { dTag, pubkey: decoded.data }
          }
        } catch {}
      }
      
      // Pattern 4: d-tag and npub in path (e.g., https://wikifreedia.xyz/nostr-event-register/npub1...)
      // Only check if we haven't already matched a more specific pattern
      if (!dtagNpubMatch && !dtagHexMatch && !dtagSlashNpubMatch) {
        const pathNpubMatch = cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
        if (pathNpubMatch) {
          const npub = pathNpubMatch[1]
          const npubIndex = cleanedUrl.indexOf(npub)
          const pathBeforeNpub = cleanedUrl.substring(0, npubIndex)
          const pathSegments = pathBeforeNpub.split('/').filter(Boolean)
          if (pathSegments.length > 0) {
            const possibleDTag = pathSegments[pathSegments.length - 1]
            try {
              const decoded = nip19.decode(npub)
              if (decoded.type === 'npub') {
                return { dTag: possibleDTag, pubkey: decoded.data }
              }
            } catch {}
          }
        }
      }
      
      // Pattern 5: d-tag only with /d/ prefix - try to find pubkey in URL
      // Only check if we haven't already matched a pattern with both d-tag and pubkey
      if (!dtagNpubMatch && !dtagHexMatch && !dtagSlashNpubMatch) {
        const dtagOnlyMatch = cleanedUrl.match(/\/d\/([^\/\?\#\&]+)/i)
        if (dtagOnlyMatch) {
          const dTag = dtagOnlyMatch[1]
          const urlParts = cleanedUrl.split('/d/')
          const pathBefore = urlParts[0].split('/').filter(Boolean)
          const pathAfter = urlParts[1] ? urlParts[1].split('/').filter(Boolean) : []
          const allPathParts = [...pathBefore, ...pathAfter]
          
          for (const part of allPathParts) {
            if (/^npub1[a-z0-9]{58}$/i.test(part)) {
              try {
                const decoded = nip19.decode(part)
                if (decoded.type === 'npub') {
                  return { dTag, pubkey: decoded.data }
                }
              } catch {}
            } else if (/^[a-f0-9]{64}$/i.test(part)) {
              return { dTag, pubkey: part }
            }
          }
          // If no pubkey found, return d-tag only (we can't fetch without pubkey, will show OG card)
          return { dTag, pubkey: null }
        }
      }
    } catch (error) {
      // Failed to parse
    }
    return null
  }, [cleanedUrl])

  // Fetch replaceable event by d-tag and pubkey (without kind)
  // If pubkey is null, fetch by d-tag only (across all authors)
  // Only use the result if exactly one event is found (to avoid ambiguous d-tags)
  const [fetchedReplaceableEvent, setFetchedReplaceableEvent] = useState<Event | null>(null)
  const [isFetchingReplaceableEvent, setIsFetchingReplaceableEvent] = useState(false)
  
  useEffect(() => {
    if (!replaceableEventInfo || !replaceableEventInfo.dTag) {
      setFetchedReplaceableEvent(null)
      setIsFetchingReplaceableEvent(false)
      return
    }
    
    setIsFetchingReplaceableEvent(true)
    
    // Fetch replaceable events by d-tag and pubkey across all replaceable kinds
    // Common replaceable event kinds
    const replaceableKinds = [30023, 30818, 30041, 30817, 30040, 30024]
    
    const fetchReplaceableEvent = async () => {
      try {
        const filters = replaceableKinds.map(kind => {
          const filter: any = {
            kinds: [kind],
            '#d': [replaceableEventInfo.dTag],
            limit: 1
          }
          // Only filter by author if we have a pubkey
          if (replaceableEventInfo.pubkey) {
            filter.authors = [replaceableEventInfo.pubkey]
          }
          return filter
        })
        
        const events = await queryService.fetchEvents(FAST_READ_RELAY_URLS, filters)
        
        // Find all events with matching d-tag
        const matchingEvents = events.filter(event => {
          const eventDTag = event.tags.find(tagNameEquals('d'))?.[1]
          return eventDTag === replaceableEventInfo.dTag
        })
        
        // Only use the result if exactly one event is found
        // If zero or multiple events, fall back to OG card (ambiguous d-tag)
        if (matchingEvents.length === 1) {
          setFetchedReplaceableEvent(matchingEvents[0])
        } else {
          setFetchedReplaceableEvent(null)
        }
      } catch (error) {
        // Failed to fetch
        setFetchedReplaceableEvent(null)
      } finally {
        setIsFetchingReplaceableEvent(false)
      }
    }
    
    fetchReplaceableEvent()
  }, [replaceableEventInfo])

  // Extract nostr identifier from URL
  // If we found a replaceable event and fetched it, create naddr from the fetched event
  // Otherwise, check for direct nostr identifiers
  const nostrIdentifier = useMemo(() => {
    // If we found a replaceable event and fetched it, create naddr from the fetched event
    if (fetchedReplaceableEvent) {
      try {
        const eventDTag = fetchedReplaceableEvent.tags.find(tagNameEquals('d'))?.[1] || ''
        const naddr = nip19.naddrEncode({
          kind: fetchedReplaceableEvent.kind,
          pubkey: fetchedReplaceableEvent.pubkey,
          identifier: eventDTag
        })
        return naddr
      } catch {
        // Failed to encode
      }
    }
    
    // Check for direct nostr identifiers in URL
    // IMPORTANT: Check for npub in specific paths (like /p/npub1...) to avoid treating as event
    const isNpubOnlyPath = /\/p\/(npub1[a-z0-9]{58})/i.test(cleanedUrl) || 
                           /\/profile\/(npub1[a-z0-9]{58})/i.test(cleanedUrl) ||
                           /\/user\/(npub1[a-z0-9]{58})/i.test(cleanedUrl)
    
    const naddrMatch = cleanedUrl.match(/(naddr1[a-z0-9]+)/i)
    const neventMatch = cleanedUrl.match(/(nevent1[a-z0-9]+)/i)
    const noteMatch = cleanedUrl.match(/(note1[a-z0-9]{58})/i)
    const npubMatch = isNpubOnlyPath ? null : cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
    const nprofileMatch = cleanedUrl.match(/(nprofile1[a-z0-9]+)/i)
    
    // If npub-only path, extract npub for profile
    if (isNpubOnlyPath) {
      const npubPathMatch = cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
      return npubPathMatch?.[1] || null
    }
    
    return naddrMatch?.[1] || neventMatch?.[1] || noteMatch?.[1] || npubMatch?.[1] || nprofileMatch?.[1] || null
  }, [cleanedUrl, fetchedReplaceableEvent])

  // Determine nostr type and extract details
  const nostrDetails = useMemo(() => {
    if (!nostrIdentifier) return null
    try {
      const decoded = nip19.decode(nostrIdentifier)
      const details: {
        type: string
        hexId?: string
        dTag?: string
        kind?: number
        pubkey?: string
        identifier?: string
      } = { type: decoded.type }
      
      if (decoded.type === 'note') {
        details.hexId = decoded.data
      } else if (decoded.type === 'nevent') {
        details.hexId = decoded.data.id
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.author
      } else if (decoded.type === 'naddr') {
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.pubkey
        details.identifier = decoded.data.identifier
        details.dTag = decoded.data.identifier
      } else if (decoded.type === 'npub') {
        details.pubkey = decoded.data
      } else if (decoded.type === 'nprofile') {
        details.pubkey = decoded.data.pubkey
      }
      
      return details
    } catch {
      return null
    }
  }, [nostrIdentifier])
  
  const nostrType = nostrDetails?.type || null

  // Fetch profile for npub/nprofile
  const profileId = nostrType === 'npub' || nostrType === 'nprofile' ? (nostrIdentifier || undefined) : undefined
  const { profile: fetchedProfile, isFetching: isFetchingProfile } = useFetchProfile(profileId)

  // Fetch event for naddr/nevent/note
  // If we already fetched a replaceable event, use that; otherwise fetch by identifier
  const eventId = (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') ? (nostrIdentifier || undefined) : undefined
  const { event: fetchedEventById, isFetching: isFetchingEvent } = useFetchEvent(eventId)
  const fetchedEvent = fetchedReplaceableEvent || fetchedEventById
  const isFetchingEventFinal = isFetchingReplaceableEvent || isFetchingEvent
  
  // Fetch profile for event author (to show avatar in event cards)
  const eventAuthorProfileId = fetchedEvent?.pubkey ? nip19.npubEncode(fetchedEvent.pubkey) : undefined
  const { profile: eventAuthorProfile } = useFetchProfile(eventAuthorProfileId)
  

  // Create synthetic event for content preview rendering - ALWAYS call hooks before any returns
  const previewEvent = useMemo(() => {
    if (!fetchedEvent?.content) return null
    // Create a synthetic event with the content for MarkdownArticle rendering
    // We'll use the full content and let CSS handle truncation
    return {
      ...fetchedEvent,
      content: fetchedEvent.content
    } as Event
  }, [fetchedEvent])

  // Determine which image to use for event cards
  const eventMetadata = fetchedEvent ? getLongFormArticleMetadataFromEvent(fetchedEvent) : null
  const eventImage = eventMetadata?.image
  const imetaInfos = fetchedEvent ? getImetaInfosFromEvent(fetchedEvent) : []
  let eventImageThumbnail: string | null = null
  if (eventImage && fetchedEvent) {
    const cleanedEventImage = cleanUrl(eventImage)
    const matchingImeta = imetaInfos.find(info => cleanUrl(info.url) === cleanedEventImage)
    eventImageThumbnail = matchingImeta?.thumb || eventImage
  }
  // Prefer the page's own Open Graph / meta when the fetch returns anything useful.
  const hasOpengraphData = !isInternalAppLink && hasUsableOpenGraphMetadata({ title, description, image })

  // While OG is loading for external URLs, avoid flashing the nostr / hostname fallback.
  if (!isInternalAppLink && ogLoading) {
    return (
      <div
        className={cn(
          WEB_PREVIEW_CARD,
          'relative w-full overflow-hidden rounded-lg border',
          ARTICLE_HERO_ASPECT,
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 z-[1] space-y-2 p-3">
          <Skeleton className="h-3 w-24 bg-white/20" />
          <Skeleton className="h-4 w-full bg-white/25" />
          <Skeleton className="h-3 w-4/5 bg-white/20" />
        </div>
      </div>
    )
  }

  // Nostr-enhanced cards only when the target page did not provide usable preview metadata.
  if (!hasOpengraphData) {
    // Enhanced card for event URLs (always show if nostr identifier detected, even while loading)
    if (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') {
      const eventTypeName = fetchedEvent ? getEventTypeName(fetchedEvent.kind) : null
      const eventSummary = eventMetadata?.summary || description

      // Fallback to OG image from website if event doesn't have an image
      // The OG image is already converted to absolute URL by useFetchWebMetadata
      // Prioritize: event image tag > OG image from URL metadata (not favicon)
      const displayImage = eventImageThumbnail || image
      
      // Truncate original URL to 150 characters
      const truncatedUrl = url.length > 150 ? url.substring(0, 150) + '...' : url

      // Determine which article component to use based on event kind
      const isAsciidocEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.WIKI_ARTICLE || fetchedEvent.kind === ExtendedKind.PUBLICATION_CONTENT)
      const isMarkdownEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.NOSTR_SPECIFICATION)
      // Only show content preview if summary exists (exclude LongFormArticle - they should show summary instead)
      const showContentPreview = eventSummary && previewEvent && previewEvent.content && (isAsciidocEvent || isMarkdownEvent)
      
      // Get title with fallbacks
      const eventTitle = getTitleWithFallbacks(fetchedEvent || null, eventMetadata) || eventTypeName

      const renderEventFooter = (titleOnHero: boolean) => (
        <div className="min-w-0 overflow-hidden">
          <div className="mb-1 flex items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {fetchedEvent ? (
                <>
                  <Username userId={fetchedEvent.pubkey} className="web-preview-muted" />
                  {eventAuthorProfile?.avatar && (
                    <img
                      src={eventAuthorProfile.avatar}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                  <span className="web-preview-muted shrink-0 text-muted-foreground">•</span>
                  <span className="web-preview-muted truncate text-muted-foreground">{eventTypeName}</span>
                </>
              ) : (
                <span className="web-preview-muted truncate text-muted-foreground">
                  {isFetchingEventFinal ? 'Loading event...' : 'Event'}
                </span>
              )}
            </div>
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            >
              <ExternalLink className="h-3 w-3 text-primary" />
            </a>
          </div>
          {fetchedEvent && !titleOnHero && eventTitle ? (
            <div className="web-preview-title mb-1 line-clamp-2 font-display font-semibold text-brand-wordmark">
              {eventTitle}
            </div>
          ) : null}
          {fetchedEvent && !titleOnHero && eventSummary && !showContentPreview ? (
            <div className="web-preview-muted mb-1 line-clamp-2 text-muted-foreground">{eventSummary}</div>
          ) : null}
          {fetchedEvent && showContentPreview ? (
            <div className="web-preview-muted my-2 line-clamp-6 overflow-hidden [&_h1]:hidden [&_h2]:hidden [&_img]:hidden">
              {isAsciidocEvent ? (
                <AsciidocArticle
                  event={previewEvent}
                  className="pointer-events-none"
                  hideImagesAndInfo={true}
                />
              ) : (
                <MarkdownArticle event={previewEvent} className="pointer-events-none" hideMetadata={true} />
              )}
            </div>
          ) : null}
          <hr className="mb-2 mt-3 border-t border-border" />
          <a
            href={cleanedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="web-preview-muted block truncate break-all text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-2"
          >
            {truncatedUrl}
          </a>
        </div>
      )

      if (fetchedEvent && isArticleHeroCardKind(fetchedEvent.kind)) {
        return (
          <ArticleHeroCard
            className={cn(WEB_PREVIEW_CARD, 'max-w-full', className)}
            event={fetchedEvent}
            imageUrl={displayImage && isSafeMediaUrl(displayImage) ? displayImage : undefined}
            title={
              eventTitle ? (
                <span className="font-display text-brand-wordmark">{eventTitle}</span>
              ) : undefined
            }
            summary={!showContentPreview && eventSummary ? eventSummary : undefined}
            footer={renderEventFooter(true)}
            onClick={(e) => e.stopPropagation()}
          />
        )
      }

      // Vertical event card: cover image on top, text below (non-article kinds).
      return (
        <div
          className={cn(
            WEB_PREVIEW_CARD,
            'flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-card bg-gradient-to-b from-primary/[0.07] to-transparent p-3 dark:from-primary/15',
            className
          )}
        >
          {displayImage && isSafeMediaUrl(displayImage) && (
            <div
              className={cn(
                '-mx-3 -mt-3 relative mb-3 overflow-hidden bg-gradient-to-b from-primary/[0.07] to-transparent dark:from-primary/15',
                ARTICLE_HERO_ASPECT
              )}
            >
              <Image
                image={{ url: displayImage, pubkey: fetchedEvent?.pubkey, dim: ARTICLE_HERO_COVER_DIM }}
                className={ARTICLE_HERO_IMAGE_CLASS}
                classNames={{ wrapper: ARTICLE_HERO_IMAGE_WRAPPER_CLASS }}
                hideIfError
              />
            </div>
          )}
          {renderEventFooter(false)}
        </div>
      )
    }

    // Enhanced card for profile URLs (loading state)
    if (nostrType === 'npub' || nostrType === 'nprofile') {
      // Truncate original URL to 150 characters
      const truncatedUrl = url.length > 150 ? url.substring(0, 150) + '...' : url
      
      return (
        <div
          className={cn(
            WEB_PREVIEW_CARD,
            'p-3 flex w-full border border-border rounded-lg overflow-hidden gap-0 bg-card bg-gradient-to-r from-primary/[0.07] to-transparent dark:from-primary/15 max-w-full',
            className
          )}
        >
          {fetchedProfile?.avatar && (
            <div className="w-20 sm:w-28 md:w-36 lg:w-40 max-w-[80px] sm:max-w-[112px] md:max-w-[144px] lg:max-w-none flex-shrink-0 bg-gradient-to-r from-primary/[0.07] to-transparent dark:from-primary/15 -my-3 -ml-3 -mr-0 flex items-center justify-center rounded-l-lg overflow-hidden">
              <Image
                image={{ url: fetchedProfile.avatar, pubkey: fetchedProfile.pubkey }}
                className="w-full h-full object-cover"
                hideIfError
              />
            </div>
          )}
          <div className="flex-1 min-w-0 pl-3 overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {fetchedProfile ? (
                  <>
                    <Username userId={fetchedProfile.pubkey} />
                    {fetchedProfile.nip05 && (
                      <>
                        <span className="web-preview-muted text-muted-foreground flex-shrink-0">•</span>
                        <span className="web-preview-muted text-primary truncate">{fetchedProfile.nip05}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="web-preview-muted text-muted-foreground truncate">
                    {isFetchingProfile ? 'Loading profile...' : 'Profile'}
                  </span>
                )}
              </div>
              <a
                href={cleanedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3 text-primary" />
              </a>
            </div>
            <ProfileAbout
              about={fetchedProfile?.about}
              className="web-preview-muted text-muted-foreground line-clamp-2 mb-1 mt-1 break-words"
            />
            <hr className="mt-4 mb-2 border-t border-border" />
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="web-preview-muted text-muted-foreground truncate block hover:text-foreground hover:underline underline-offset-2 transition-colors break-all"
            >
              {truncatedUrl}
            </a>
          </div>
        </div>
      )
    }

    // Internal Imwald links get route-specific titles (not the shared index.html OG).
    const imwaldPreview =
      isInternalAppLink &&
      (() => {
        try {
          return resolveImwaldRouteSocialCopy(new URL(cleanedUrl).pathname, '')
        } catch {
          return null
        }
      })()

    if (imwaldPreview) {
      return (
        <div
          className={cn(
            WEB_PREVIEW_CARD,
            'p-3 flex w-full border border-border rounded-lg overflow-hidden gap-3 bg-card bg-gradient-to-r from-primary/[0.07] to-transparent dark:from-primary/15 max-w-full',
            className
          )}
        >
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-start gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <div className="web-preview-title font-display font-semibold text-brand-wordmark truncate">
                  {imwaldPreview.ogTitle}
                </div>
                <div className="web-preview-muted text-muted-foreground line-clamp-3 mt-0.5">
                  {imwaldPreview.description}
                </div>
              </div>
              <a
                href={cleanedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3 text-primary" />
              </a>
            </div>
            <hr className="mt-4 mb-2 border-t border-border" />
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="web-preview-muted text-muted-foreground break-all line-clamp-2 block hover:text-foreground hover:underline underline-offset-2 transition-colors"
            >
              {cleanedUrl}
            </a>
          </div>
        </div>
      )
    }

    return null
  }

  // Link preview: cropped hero image with title/domain overlaid (not stacked below).
  return (
    <OpenGraphHeroCard
      cleanedUrl={cleanedUrl}
      url={url}
      hostname={hostname}
      title={title}
      description={description}
      image={image}
      className={className}
    />
  )
}
