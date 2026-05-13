import { Skeleton } from '@/components/ui/skeleton'
import ExternalLink from '@/components/ExternalLink'
import {
  FAST_READ_RELAY_URLS,
  PROFILE_RELAY_URLS,
  SEARCHABLE_RELAY_URLS,
  ExtendedKind
} from '@/constants'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { LIVE_ACTIVITY_KINDS } from '@/lib/live-activities'
import { isCalendarEventKind } from '@/lib/calendar-event'
import { isRenderableNoteKind } from '@/lib/note-renderable-kinds'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import nip66Service from '@/services/nip66.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import { useViewerInboxRelayUrls } from '@/hooks/useViewerInboxRelayUrls'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { useFavoriteRelays } from '@/providers/favorite-relays-context'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useReply } from '@/providers/ReplyProvider'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { relayHintWssUrlsFromEvent } from '@/lib/event'
import { Event, nip19 } from 'nostr-tools'
import ClientSelect from '../ClientSelect'
import MainNoteCard from '../NoteCard/MainNoteCard'
import UnknownNote from '../Note/UnknownNote'
import { EmbeddedCalendarEvent } from './EmbeddedCalendarEvent'
import logger from '@/lib/logger'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { contentParserService } from '@/services/content-parser.service'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import {
  type EmbeddedNoteIdValidation,
  validateEmbeddedNotePointer
} from './embeddedNotePointer'
import { useSuppressEmbeddedNoteId } from '@/contexts/suppress-embedded-note-context'

/** Embedded `noteId` is often raw hex from parsers; must accept A–F and normalize for REQ `ids`. */
function hexEventIdFromNoteId(noteId: string): string | null {
  const trimmed = noteId.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  try {
    const { type, data } = nip19.decode(noteId)
    if (type === 'note') return data
    if (type === 'nevent') return data.id
    return null
  } catch {
    return null
  }
}

/** For naddr (replaceable events), return coordinate kind:pubkey:identifier for suppression matching. */
function coordinateFromNoteId(noteId: string): string | null {
  try {
    const { type, data } = nip19.decode(noteId.trim())
    if (type === 'naddr' && data) {
      const id = data.identifier ?? ''
      return `${data.kind}:${data.pubkey}:${id}`.toLowerCase()
    }
    return null
  } catch {
    return null
  }
}

/** True if `fetchEventWithExternalRelays(noteId, …)` can build a REQ filter (hex, note, nevent, naddr). */
function canSearchOnExternalRelays(noteId: string): boolean {
  if (hexEventIdFromNoteId(noteId)) return true
  try {
    return nip19.decode(noteId.trim()).type === 'naddr'
  } catch {
    return false
  }
}

export function EmbeddedNote({
  noteId,
  className,
  containingEvent,
  showFull = false
}: {
  noteId: string
  className?: string
  containingEvent?: Event
  /** True = full long-form/publication body; false = compact card (use inside articles). */
  showFull?: boolean
}) {
  const suppress = useSuppressEmbeddedNoteId()
  const embeddedHexId = useMemo(() => hexEventIdFromNoteId(noteId), [noteId])
  const embeddedCoordinate = useMemo(() => coordinateFromNoteId(noteId), [noteId])
  const validation = useMemo(() => validateEmbeddedNotePointer(noteId), [noteId])
  if (suppress) {
    if (embeddedHexId && embeddedHexId === suppress.hexId.toLowerCase()) return null
    if (suppress.coordinate && embeddedCoordinate && embeddedCoordinate === suppress.coordinate.toLowerCase())
      return null
  }
  if (!validation.valid) {
    return (
      <EmbeddedNoteInvalid
        className={className}
        noteId={noteId}
        validation={validation}
      />
    )
  }
  return (
    <EmbeddedNoteContent
      noteId={noteId}
      className={className}
      containingEvent={containingEvent}
      showFull={showFull}
    />
  )
}

function EmbeddedNoteInvalid({
  noteId,
  className,
  validation
}: {
  noteId: string
  className?: string
  validation: Exclude<EmbeddedNoteIdValidation, { valid: true }>
}) {
  const { t } = useTranslation()
  const trimmed = noteId.trim()
  const isNsecLike = /^nsec1/i.test(trimmed) || validation.decodedType === 'nsec'
  const preview =
    trimmed.length > 96 ? `${trimmed.slice(0, 96)}…` : trimmed || '—'

  let message: string
  switch (validation.reason) {
    case 'empty':
      message = t('embeddedNoteInvalidEmpty')
      break
    case 'invalid_hex':
      message = t('embeddedNoteInvalidHex')
      break
    case 'wrong_nip19_type':
      message = t('embeddedNoteInvalidWrongKind', {
        type: validation.decodedType ?? 'unknown'
      })
      break
    case 'invalid_bech32':
    default:
      message = t('embeddedNoteInvalidBech32')
      break
  }

  return (
    <div
      className={cn('not-prose max-w-full text-left p-3 border border-destructive/30 rounded-lg bg-destructive/5', className)}
      onClick={(e) => e.stopPropagation()}
      data-embedded-note-invalid
    >
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div className="text-sm font-medium text-destructive">{t('Invalid embedded note reference')}</div>
        <p className="text-xs leading-relaxed">{message}</p>
        {validation.reason !== 'empty' && !isNsecLike && (
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-foreground/80">
            {preview}
          </pre>
        )}
        <ClientSelect className="w-full" originalNoteId={trimmed || undefined} />
      </div>
    </div>
  )
}

function SuppressedLiveStreamEmbed({ noteId, className }: { noteId: string; className?: string }) {
  const { t } = useTranslation()
  const trimmed = noteId.trim()
  const njump = `https://njump.me/${trimmed}`

  return (
    <div
      className={cn('not-prose max-w-full rounded-lg border p-3 text-left', className)}
      onClick={(e) => e.stopPropagation()}
      data-live-embed-suppressed
    >
      <p className="mb-2 text-xs text-muted-foreground">{t('liveStreamEmbedSuppressed')}</p>
      <ExternalLink url={njump} className="text-sm break-all" />
      <ClientSelect className="mt-2 w-full" originalNoteId={trimmed || undefined} />
    </div>
  )
}

/**
 * Fetches and renders an embedded note: wide-relay REQ immediately in parallel with the normal
 * fetch path (no “try external” gate — embeds are always worth the index-relay fan-out).
 */
function EmbeddedNoteFetched({
  noteId,
  className,
  containingEvent,
  showFull,
  allowLiveEmbeds
}: {
  noteId: string
  className?: string
  containingEvent?: Event
  showFull: boolean
  allowLiveEmbeds: boolean
}) {
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { inboxRelayUrls } = useViewerInboxRelayUrls()
  const [event, setEvent] = useState<Event | undefined>(undefined)
  const [isFetching, setIsFetching] = useState(true)
  const eventRef = useRef<Event | undefined>(undefined)
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  eventRef.current = event

  const relayHintsFromParent = useMemo(
    () => relayHintWssUrlsFromEvent(containingEvent),
    [containingEvent?.id]
  )
  const menuRelayUrls = useMemo(
    () =>
      getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
        .map((url) => normalizeUrl(url))
        .filter((url): url is string => Boolean(url)),
    [favoriteRelays, blockedRelays]
  )
  const wideRelaysStatic = useMemo(
    () =>
      buildEmbedWideRelayUrlsStatic(
        menuRelayUrls,
        relayHintsFromParent,
        inboxRelayUrls
      ),
    [menuRelayUrls, relayHintsFromParent, inboxRelayUrls]
  )
  const fetchRelayOpts = useMemo(
    () => (relayHintsFromParent.length > 0 ? { relayHints: relayHintsFromParent } : undefined),
    [relayHintsFromParent]
  )

  const resolveAndSet = useCallback(
    (ev: Event | undefined) => {
      if (!ev || isEventDeleted(ev) || shouldDropEventOnIngest(ev)) return false
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current)
        retryIntervalRef.current = null
      }
      client.addEventToCache(ev)
      setEvent(ev)
      addReplies([ev])
      return true
    },
    [addReplies, isEventDeleted]
  )

  /** Latest relay lists without listing them as effect deps (favorites context churn would re-run the effect and `setEvent(undefined)` wiped loaded embeds → loop / “crash”). */
  const embedFetchCtxRef = useRef({
    fetchRelayOpts: undefined as { relayHints?: string[] } | undefined,
    wideRelaysStatic: [] as string[]
  })
  embedFetchCtxRef.current = { fetchRelayOpts, wideRelaysStatic }

  const resolveAndSetRef = useRef(resolveAndSet)
  resolveAndSetRef.current = resolveAndSet

  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const containingEventRef = useRef(containingEvent)
  containingEventRef.current = containingEvent

  useEffect(() => {
    let cancelled = false
    const noteKey = noteId.trim()
    eventRef.current = undefined
    setEvent(undefined)
    setIsFetching(true)

    const resolve = (ev: Event | undefined) => resolveAndSetRef.current(ev)

    const tryShortcuts = (): boolean => {
      const nav = navigationEventStore.peekEvent(noteKey)
      if (nav && resolve(nav)) return true
      const peek = client.peekSessionCachedEvent(noteKey)
      if (peek && resolve(peek)) return true
      return false
    }

    const runWidePass = async (relayUrls: string[]) => {
      if (!canSearchOnExternalRelays(noteKey) || relayUrls.length === 0) return undefined
      const ev = await client.fetchEventWithExternalRelays(noteKey, relayUrls)
      return ev
    }

    const runParallelFetch = async () => {
      const { fetchRelayOpts: opts, wideRelaysStatic: wide0 } = embedFetchCtxRef.current
      const hex = hexEventIdFromNoteId(noteKey)
      const primary = client.fetchEvent(noteKey, opts)
      const wide = runWidePass(wide0)
      const idb =
        hex && /^[0-9a-f]{64}$/i.test(hex)
          ? indexedDb.getEventFromPublicationStore(hex.toLowerCase()).catch(() => undefined)
          : Promise.resolve(undefined)
      const [p, w, db] = await Promise.all([primary, wide, idb])
      if (cancelled) return
      const chosen = pickUsableEvent([p, w, db], isEventDeletedRef.current)
      if (chosen) {
        resolve(chosen)
        setIsFetching(false)
        return
      }
      setIsFetching(false)
    }

    if (tryShortcuts()) {
      setIsFetching(false)
    } else {
      void runParallelFetch()
    }

    void (async () => {
      if (tryShortcuts() || eventRef.current) return
      const extra = await loadAsyncEmbedRelayHints(noteKey, containingEventRef.current)
      if (cancelled || eventRef.current) return
      const wide0 = embedFetchCtxRef.current.wideRelaysStatic
      const wideMerged = preferPublicIndexRelaysFirst(dedupeRelayUrls([...wide0, ...extra]))
      const ev = await runWidePass(
        feedRelayPolicyUrls([{ source: 'fallback', urls: wideMerged }], {
          operation: 'read',
          blockedRelays,
          applySocialKindBlockedFilter: false,
          allowThirdPartyLocalRelays: true
        })
      )
      if (cancelled || !ev) return
      resolve(ev)
    })()

    if (eventRef.current) {
      return () => {
        cancelled = true
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current)
          retryIntervalRef.current = null
        }
        setIsFetching(false)
      }
    }

    retryIntervalRef.current = setInterval(() => {
      if (cancelled || eventRef.current) return
      void (async () => {
        const opts = embedFetchCtxRef.current.fetchRelayOpts
        const ev = await client.fetchEventForceRetry(noteKey, opts)
        if (!cancelled && ev) resolve(ev)
      })()
    }, 8000)

    return () => {
      cancelled = true
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current)
        retryIntervalRef.current = null
      }
      setIsFetching(false)
    }
    /** Only the embed pointer and parent note identity — not relay arrays / callbacks (avoids wipe+refetch loops). */
  }, [noteId, containingEvent?.id])

  useEffect(() => {
    if (!noteId.trim() || event !== undefined) return undefined
    const id = noteId.trim()
    return eventService.subscribeWhenSessionHasEvent(id, () => {
      const peek = client.peekSessionCachedEvent(id)
      if (peek) resolveAndSetRef.current(peek)
    })
  }, [noteId, event])

  const finalEvent = event

  if (isFetching && !finalEvent) {
    return <EmbeddedNoteSkeleton className={className} />
  }

  if (!finalEvent) {
    return (
      <div
        className={cn('not-prose max-w-full text-left p-3 border rounded-lg border-dashed', className)}
        onClick={(e) => e.stopPropagation()}
        data-embedded-note-loading
      >
        <EmbeddedNoteSkeleton className="border-0 p-0 shadow-none" />
        <ClientSelect className="w-full mt-3" originalNoteId={noteId.trim() || undefined} />
      </div>
    )
  }

  if (
    !allowLiveEmbeds &&
    LIVE_ACTIVITY_KINDS.includes(finalEvent.kind as (typeof LIVE_ACTIVITY_KINDS)[number])
  ) {
    return <SuppressedLiveStreamEmbed noteId={noteId} className={className} />
  }

  // Check if this event has bookstr tags (at least "book" tag)
  const bookMetadata = extractBookMetadata(finalEvent)
  const hasBookstrTags = !!bookMetadata.book

  // If it has bookstr tags, render directly as bookstr content (no need to search)
  if (hasBookstrTags) {
    return (
      <div
        data-embedded-note
        data-bookstr
        className="not-prose max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <EmbeddedBookstrEvent event={finalEvent} originalNoteId={noteId} className={className} />
      </div>
    )
  }

  // NIP-52 calendar notes (kinds 31922 / 31923) – render as calendar card
  if (isCalendarEventKind(finalEvent.kind)) {
    return (
      <div
        data-embedded-note
        className="not-prose max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <EmbeddedCalendarEvent event={finalEvent} className={className} />
      </div>
    )
  }

  if (!isRenderableNoteKind(finalEvent.kind)) {
    return (
      <div
        data-embedded-note
        data-embedded-unsupported
        className="not-prose max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <UnknownNote
          event={finalEvent}
          showAuthorSummary
          className={cn('my-0 p-2 sm:p-3 border rounded-lg w-full', className)}
        />
      </div>
    )
  }

  // Otherwise, render as regular embedded note
  return (
    <div
      data-embedded-note
      className="not-prose max-w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <MainNoteCard
        className={cn('w-full', className)}
        event={finalEvent}
        embedded
        showFull={showFull}
        originalNoteId={noteId}
      />
    </div>
  )
}

function EmbeddedNoteContent({
  noteId,
  className,
  containingEvent,
  showFull = false
}: {
  noteId: string
  className?: string
  containingEvent?: Event
  showFull?: boolean
}) {
  /** Embeds are contextual to the parent note; home kind picker must not hide NIP-53 live cards here. */
  const allowLiveEmbeds = true

  return (
    <EmbeddedNoteFetched
      noteId={noteId}
      className={className}
      containingEvent={containingEvent}
      showFull={showFull}
      allowLiveEmbeds={allowLiveEmbeds}
    />
  )
}

function dedupeRelayUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((u) => (normalizeUrl(u?.trim()) || '') as string).filter(Boolean))]
}

/** Prefer relays that usually hold / index replaceables so REQ opens useful targets first. */
function preferPublicIndexRelaysFirst(urls: readonly string[]): string[] {
  const score = (u: string) => {
    const x = u.toLowerCase()
    if (x.includes('nos.lol')) return 0
    if (x.includes('nostr.land')) return 1
    if (x.includes('relay.damus.io')) return 2
    if (x.includes('relay.primal.net')) return 3
    if (x.includes('nostr.wine')) return 4
    return 30
  }
  return [...urls].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}

/** Static + menu favorites + viewer inboxes: REQ on embed mount; always include the nostr.land aggregator. */
function buildEmbedWideRelayUrlsStatic(
  menuRelayUrls: string[],
  relayHintsFromParent: string[],
  viewerInboxRelayUrls: string[]
): string[] {
  return feedRelayPolicyUrls(
    [
      {
        source: 'fallback',
        urls: preferPublicIndexRelaysFirst(
          dedupeRelayUrls([
            ...relayHintsFromParent,
            ...viewerInboxRelayUrls,
            ...nip66Service.getSearchableRelayUrls(),
            ...SEARCHABLE_RELAY_URLS,
            ...FAST_READ_RELAY_URLS,
            ...PROFILE_RELAY_URLS,
            ...menuRelayUrls
          ])
        )
      }
    ],
    {
      operation: 'read',
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
}

/** NIP-65 / nevent relays / seen-on — merged into a second wide REQ if the first pass missed. */
async function loadAsyncEmbedRelayHints(noteId: string, containingEvent?: Event): Promise<string[]> {
  const hintRelays: string[] = []
  const resolvedHexId = (() => {
    const h = hexEventIdFromNoteId(noteId)
    if (h) return h
    try {
      const { type, data } = nip19.decode(noteId.trim())
      if (type === 'nevent') return data.id
      if (type === 'note') return data
    } catch {
      return null
    }
    return null
  })()

  if (containingEvent) {
    try {
      const containingAuthorRelayList = await client
        .fetchRelayList(containingEvent.pubkey)
        .catch(() => ({ read: [] as string[], write: [] as string[] }))
      hintRelays.push(
        ...(containingAuthorRelayList.read ?? []).slice(0, 12),
        ...(containingAuthorRelayList.write ?? []).slice(0, 12)
      )
    } catch (err) {
      logger.debug('[EmbeddedNote] containing author relays failed', { error: err })
    }
  }

  try {
    const { type, data } = nip19.decode(noteId.trim())
    if (type === 'nevent') {
      if (data.relays) hintRelays.push(...data.relays)
      if (data.author) {
        const authorRelayList = await client
          .fetchRelayList(data.author)
          .catch(() => ({ read: [] as string[], write: [] as string[] }))
        hintRelays.push(
          ...(authorRelayList.read ?? []).slice(0, 12),
          ...(authorRelayList.write ?? []).slice(0, 12)
        )
      }
    } else if (type === 'naddr') {
      if (data.relays) hintRelays.push(...data.relays)
      const authorRelayList = await client
        .fetchRelayList(data.pubkey)
        .catch(() => ({ read: [] as string[], write: [] as string[] }))
      hintRelays.push(
        ...(authorRelayList.read ?? []).slice(0, 12),
        ...(authorRelayList.write ?? []).slice(0, 12)
      )
    }
  } catch {
    /* invalid */
  }

  if (resolvedHexId) {
    hintRelays.push(...client.getSeenEventRelayUrls(resolvedHexId))
  }
  return dedupeRelayUrls(hintRelays)
}

function pickUsableEvent(
  candidates: (Event | undefined)[],
  isEventDeleted: (e: Event) => boolean
): Event | undefined {
  for (const e of candidates) {
    if (!e || isEventDeleted(e) || shouldDropEventOnIngest(e)) continue
    return e
  }
  return undefined
}

function EmbeddedNoteSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('not-prose max-w-full text-left p-2 sm:p-3 border rounded-lg', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center space-x-2">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div>
          <Skeleton className="h-3 w-16 my-1" />
          <Skeleton className="h-3 w-16 my-1" />
        </div>
      </div>
      <Skeleton className="w-full h-4 my-1 mt-2" />
      <Skeleton className="w-2/3 h-4 my-1" />
    </div>
  )
}

/**
 * Render a single bookstr event directly (no searching needed)
 */
function EmbeddedBookstrEvent({ event, originalNoteId, className }: { event: Event; originalNoteId?: string; className?: string }) {
  const [parsedContent, setParsedContent] = useState<string | null>(null)
  const bookMetadata = extractBookMetadata(event)
  const { navigateToNote } = useSmartNoteNavigationOptional()

  useEffect(() => {
    const parseContent = async () => {
      try {
        const result = await contentParserService.parseContent(event.content, {
          eventKind: ExtendedKind.PUBLICATION_CONTENT
        })
        setParsedContent(result.html)
      } catch (err) {
        logger.warn('Error parsing bookstr event content', { error: err, eventId: event.id.substring(0, 8) })
        setParsedContent(event.content)
      }
    }
    parseContent()
  }, [event])

  const chapterNum = bookMetadata.chapter
  const verseNum = bookMetadata.verse
  const version = bookMetadata.version
  const bookName = bookMetadata.book 
    ? bookMetadata.book
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    : ''

  const content = parsedContent || event.content

  return (
    <div 
      className={cn('border rounded-lg p-3 bg-muted/30 clickable', className)}
      data-event-id={event.id}
      onClick={(e) => {
        // Don't navigate if clicking on interactive elements
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a')) {
          return
        }
        e.stopPropagation()
        const noteUrl = toNote(
          originalNoteId ?? event,
          typeof originalNoteId === 'string' && /^[0-9a-f]{64}$/i.test(originalNoteId.trim())
            ? event
            : undefined
        )
        navigateToNote(noteUrl, event, getCachedThreadContextEvents(event))
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <h4 className="font-semibold text-sm">
          {bookName}
          {chapterNum && ` ${chapterNum}`}
          {verseNum && `:${verseNum}`}
          {version && ` (${version.toUpperCase()})`}
        </h4>
      </div>

      {/* Content */}
      <div className="flex gap-2 text-sm leading-relaxed items-baseline">
        {/* Verse number on the left - only show verse number, not chapter:verse */}
        <span className="font-semibold text-muted-foreground shrink-0 min-w-[2.5rem] text-right">
          {verseNum || null}
        </span>
        {/* Content on the right */}
        <span className="flex-1" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  )
}
