import { Event, kinds } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'
import HighlightSourcePreview from '@/components/UniversalContent/HighlightSourcePreview'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { toNote } from '@/lib/link'
import { isPseudoNostrHttpsUrl, isLikelyWebPageUrl, simplifyUrl } from '@/lib/url'
import { getHighlightSourceHttpUrl } from '@/lib/rss-article'
import { useFetchEvent } from '@/hooks'
import { useEffect, useState, useMemo } from 'react'
import { ExtendedKind } from '@/constants'
import { useTranslation } from 'react-i18next'
import { resolveNip84HighlightDisplay } from '@/lib/nip84-highlight-display'

function stripOuterQuotes(s: string): string {
  let t = s.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1).trim()
  }
  return t
}

/**
 * Check if a string is a URL or Nostr address
 */
function isUrlOrNostrAddress(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false
  }
  
  // Check if it's a URL (http://, https://, or starts with common URL patterns)
  try {
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('ws://') || value.startsWith('wss://')) {
      new URL(value) // Validate it's a proper URL
      return true
    }
  } catch {
    // Not a valid URL
  }

  // Check if it's a Nostr address (nostr: prefix or bech32 encoded)
  if (value.startsWith('nostr:')) {
    return true
  }

  // Check if it's a bech32 encoded Nostr address
  try {
    const decoded = nip19.decode(value)
    if (['npub', 'nprofile', 'nevent', 'naddr', 'note', 'nrelay'].includes(decoded.type)) {
      return true
    }
  } catch {
    // Not a valid Nostr address
  }

  return false
}

/**
 * Simple author card for highlights with Nostr sources (e-tags, r-tags)
 * Shows just "A note from: [user badge]" instead of the full embedded note
 * The word "note" is a hyperlink to the referenced event
 */
function HighlightAuthorCard({ 
  authorPubkey, 
  eventId,
  onClick 
}: { 
  authorPubkey: string
  eventId?: string
  onClick?: () => void
}) {
  const { navigateToNote } = useSmartNoteNavigationOptional()
  
  const handleNoteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClick) {
      onClick()
    } else if (eventId) {
      navigateToNote(toNote(eventId))
    }
  }
  
  return (
    <div 
      className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50"
    >
      <span className="text-sm text-muted-foreground">
        A{' '}
        <button
          onClick={handleNoteClick}
          className="text-primary hover:text-foreground hover:underline underline-offset-2 transition-colors font-medium cursor-pointer"
        >
          note
        </button>
        {' '}from:
      </span>
      <UserAvatar userId={authorPubkey} size="small" />
      <Username userId={authorPubkey} className="text-sm font-medium" />
    </div>
  )
}

export default function Highlight({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  // State for storing the referenced event's author
  const [referencedEventAuthor, setReferencedEventAuthor] = useState<string | null>(null)
  const [sourceEventId, setSourceEventId] = useState<string | null>(null)
  const [sourceBech32, setSourceBech32] = useState<string | null>(null)
  
  try {

    // Extract the source (e-tag, a-tag, or r-tag) with improved priority handling
    let source = null
    let quoteSource: string | null = null // For plain text r-tags that aren't URLs/Nostr addresses
    let sourceTag: string[] | undefined
    
    // Check for 'source' marker first (highest priority)
    for (const tag of event.tags) {
      if (tag[2] === 'source' || tag[3] === 'source') {
        sourceTag = tag
        break
      }
    }
    
    // If no 'source' marker found, process tags in priority order: e > a > r
    if (!sourceTag) {
      for (const tag of event.tags) {
        // Give 'e' tags highest priority
        if (tag[0] === 'e') {
          sourceTag = tag
          continue
        }
        
        // Give 'a' tags second priority (but don't override 'e' tags)
        if (tag[0] === 'a' && (!sourceTag || sourceTag[0] !== 'e')) {
          sourceTag = tag
          continue
        }
        
        // Give 'r' tags lowest priority (skip fake `https://nostr:…` r-tags — not web URLs)
        if (tag[0] === 'r' && (!sourceTag || sourceTag[0] === 'r')) {
          if (tag[1] && isPseudoNostrHttpsUrl(tag[1])) continue
          sourceTag = tag
          continue
        }
      }
    }
    
    // Process the selected source tag
    // We'll fetch the referenced event to get the author pubkey
    let tempSourceEventId: string | null = null // Event ID or bech32 for fetching the event
    let tempSourceBech32: string | null = null // Bech32 ID for navigation
    if (sourceTag) {
      if (sourceTag[0] === 'e' && sourceTag[1]) {
        source = {
          type: 'event' as const,
          value: sourceTag[1],
          bech32: nip19.noteEncode(sourceTag[1])
        }
        tempSourceEventId = sourceTag[1] // Store event ID for fetching
        tempSourceBech32 = nip19.noteEncode(sourceTag[1]) // Store bech32 for navigation
      } else if (sourceTag[0] === 'a' && sourceTag[1]) {
        const [kind, pubkey, identifier] = sourceTag[1].split(':')
        const relay = sourceTag[2]
        const bech32 = nip19.naddrEncode({
          kind: parseInt(kind),
          pubkey,
          identifier: identifier || '',
          relays: relay ? [relay] : []
        })
        source = {
          type: 'addressable' as const,
          value: sourceTag[1],
          bech32
        }
        tempSourceEventId = bech32 // Store bech32 for fetching the event
        tempSourceBech32 = bech32 // Store bech32 for navigation
      } else if (sourceTag[0] === 'r') {
        // Ignore fake `https://nostr:…` (invalid https; breaks WebPreview)
        if (sourceTag[1] && isPseudoNostrHttpsUrl(sourceTag[1])) {
          // no source / no quote card for this tag
        } else if (sourceTag[1] && isUrlOrNostrAddress(sourceTag[1])) {
          // Try to decode as Nostr address to extract author
          try {
            const decoded = nip19.decode(sourceTag[1])
            if (decoded.type === 'naddr') {
              // For naddr, we have the pubkey directly
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else if (decoded.type === 'nevent') {
              // For nevent, we can fetch the event to get the author
              tempSourceEventId = sourceTag[1] // Store bech32 for fetching
              tempSourceBech32 = sourceTag[1] // Store bech32 for navigation
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else if (decoded.type === 'note') {
              // For note, we can fetch the event to get the author
              tempSourceEventId = sourceTag[1] // Store bech32 for fetching
              tempSourceBech32 = sourceTag[1] // Store bech32 for navigation
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else {
              // Other Nostr types or URL
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            }
          } catch {
            // Not a valid Nostr address, treat as regular URL
            source = {
              type: 'url' as const,
              value: sourceTag[1],
              bech32: sourceTag[1]
            }
          }
        } else if (sourceTag[1]) {
          // It's plain text, store it as a quote source
          quoteSource = sourceTag[1]
        }
      }
    }
    
    // Update state for fetching the referenced event
    useEffect(() => {
      if (tempSourceEventId) {
        setSourceEventId(tempSourceEventId)
        setSourceBech32(tempSourceBech32)
      }
    }, [tempSourceEventId, tempSourceBech32])

    // Fetch the referenced event to get the author pubkey and check if it has a special card
    const { event: referencedEvent } = useFetchEvent(sourceEventId || undefined)
    
    // Determine if the referenced event has a special card that should be used instead of simple author card
    const hasSpecialCard = useMemo(() => {
      // For r-tags that are regular URLs (http/https), they have OpenGraph cards - always use those
      if (sourceTag && sourceTag[0] === 'r' && sourceTag[1]) {
        if (
          (sourceTag[1].startsWith('http://') || sourceTag[1].startsWith('https://')) &&
          !isPseudoNostrHttpsUrl(sourceTag[1])
        ) {
          return true // URLs have OpenGraph cards - use full preview
        }
      }
      
      if (!referencedEvent) {
        // For a-tags, check the kind from the tag itself (before event is loaded)
        if (sourceTag && sourceTag[0] === 'a' && sourceTag[1]) {
          const [kindStr] = sourceTag[1].split(':')
          const kind = parseInt(kindStr)
          // Longform articles (30023) have their own preview card
          if (kind === kinds.LongFormArticle) {
            return true
          }
        }
        return false // Don't know yet - wait for event to load
      }
      
      // Events with special preview cards that should always use full preview
      const specialCardKinds = [
        kinds.LongFormArticle, // 30023 — long-form preview card
        ExtendedKind.POLL, // Has PollPreview
        ExtendedKind.DISCUSSION, // Has DiscussionNote
        ExtendedKind.VIDEO,
        ExtendedKind.SHORT_VIDEO,
        ExtendedKind.VIDEO_ADDRESSABLE,
        ExtendedKind.PICTURE, // Has PictureNotePreview
        ExtendedKind.PUBLICATION, // Has PublicationCard
        ExtendedKind.WIKI_ARTICLE, // Has special card
        ExtendedKind.NOSTR_SPECIFICATION, // Has special card
        ExtendedKind.VOICE, // Has special card
        ExtendedKind.MUSIC_TRACK,
        ExtendedKind.VOICE_COMMENT, // Has special card
      ]
      
      return specialCardKinds.includes(referencedEvent.kind)
    }, [referencedEvent, sourceTag])
    
    // Update the author when we get the referenced event
    useEffect(() => {
      if (referencedEvent) {
        setReferencedEventAuthor(referencedEvent.pubkey)
      }
    }, [referencedEvent])
    
    // For a-tags, we can also extract the pubkey directly from the tag (for immediate display)
    useEffect(() => {
      if (sourceTag && sourceTag[0] === 'a' && sourceTag[1] && !referencedEventAuthor && !hasSpecialCard) {
        const [kindStr, pubkey] = sourceTag[1].split(':')
        const kind = parseInt(kindStr)
        // Only set author for a-tags that don't have special cards
        if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey) && kind !== kinds.LongFormArticle) {
          setReferencedEventAuthor(pubkey)
        }
      }
    }, [sourceTag, referencedEventAuthor, hasSpecialCard])

    const { fullText, markedSpan, mode, sourceAnchorHint } = useMemo(
      () => resolveNip84HighlightDisplay(event),
      [event.id, event.content, event.tags]
    )

    const httpSourceUrl = useMemo(() => getHighlightSourceHttpUrl(event), [event.tags])

    const httpSourceAlreadyLinked =
      !!httpSourceUrl &&
      source?.type === 'url' &&
      isLikelyWebPageUrl(source.value)

    const markClassName =
      'bg-green-200 dark:bg-green-600 dark:text-white px-1 rounded font-medium'

    const quotedBody = useMemo(() => {
      const cleanFull = stripOuterQuotes(fullText)
      const cleanMark = stripOuterQuotes(markedSpan)
      if (!cleanFull) return null

      if (mode === 'web-annotation') {
        return (
          <mark className={markClassName} data-nip84-highlight="annotation">
            {cleanFull}
          </mark>
        )
      }

      if (!cleanMark || cleanFull === cleanMark) {
        return (
          <mark className={markClassName} data-nip84-highlight="span">
            {cleanFull}
          </mark>
        )
      }
      const pieces = cleanFull.split(cleanMark)
      if (pieces.length === 1) {
        return (
          <mark className={markClassName} data-nip84-highlight="span">
            {cleanFull}
          </mark>
        )
      }
      return pieces.map((part, index) => (
        <span key={index}>
          {part}
          {index < pieces.length - 1 && (
            <mark className={markClassName} data-nip84-highlight="span">
              {cleanMark}
            </mark>
          )}
        </span>
      ))
    }, [fullText, markedSpan, mode])

    return (
      <div className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${className || ''}`}>
        <div className="flex-1 min-w-0">
            {quotedBody && (
              <div className="note-content text-base font-normal mb-4 whitespace-pre-wrap break-words border-l-4 border-green-500 pl-5 py-4 leading-relaxed bg-green-50/30 dark:bg-green-950/20 rounded-r-lg">
                <div>{quotedBody}</div>
                {httpSourceUrl ? (
                  <p className="mt-3 text-sm border-t border-green-200/60 dark:border-green-800/60 pt-3">
                    <span className="text-muted-foreground">{t('Source', { defaultValue: 'Source' })}: </span>
                    <a
                      href={httpSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline underline-offset-2 break-all"
                    >
                      {simplifyUrl(httpSourceUrl) || httpSourceUrl}
                    </a>
                  </p>
                ) : null}
                {sourceAnchorHint ? (
                  <p className="mt-2 text-xs text-muted-foreground italic">
                    {t('Passage on source page', { defaultValue: 'Passage on source page' })}:{' '}
                    {sourceAnchorHint}
                  </p>
                ) : null}
              </div>
            )}

            {/* Quote source (plain text r-tag) */}
            {quoteSource && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 italic">
                {quoteSource.trimStart().startsWith('—') ? quoteSource : `— ${quoteSource}`}
              </div>
            )}

            {/* Source preview card. When the Source: line above already links the http URL,
                still show the OpenGraph card but suppress the bare-link fallback (ogCardOnly). */}
            {source && (
              <>
                {/* Only show simple author card if:
                    1. We have the author pubkey
                    2. The referenced event doesn't have a special card (like LongFormArticle preview)
                    3. For r-tags: only if it's a Nostr address, not a regular URL (URLs have OpenGraph cards)
                */}
                {referencedEventAuthor && !hasSpecialCard ? (
                  <div className="mt-3">
                    <HighlightAuthorCard
                      authorPubkey={referencedEventAuthor}
                      eventId={sourceBech32 || undefined}
                    />
                  </div>
                ) : (
                  // For sources with special cards, URLs with OpenGraph, or while loading, show full preview.
                  // Wrapper hides itself (incl. margin) when ogCardOnly yields no card.
                  <div className="mt-3 [&:has(>div:empty)]:hidden">
                    <HighlightSourcePreview
                      source={source}
                      ogCardOnly={httpSourceAlreadyLinked}
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
    )
  } catch (error) {
    logger.error('Highlight component error', { error, eventId: event.id })
    return (
      <div className={`relative border-l-4 border-red-500 bg-red-50/50 dark:bg-red-950/20 rounded-r-lg p-4 ${className || ''}`}>
        <div className="flex items-start gap-3">
          <Highlighter className="w-5 h-5 text-red-600 dark:text-red-500 shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-red-800 dark:text-red-200">Highlight Error:</div>
            <div className="text-red-700 dark:text-red-300 text-sm">{String(error)}</div>
            <div className="mt-2 text-sm">Content: {event.content}</div>
            <div className="text-sm">Context: {event.tags.find(tag => tag[0] === 'context')?.[1] || 'No context found'}</div>
          </div>
        </div>
      </div>
    )
  }
}

