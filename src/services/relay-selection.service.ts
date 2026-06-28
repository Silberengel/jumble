import { Event, kinds } from 'nostr-tools'
import { ExtendedKind, FAST_WRITE_RELAY_URLS, PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS, RANDOM_PUBLISH_RELAY_COUNT, RELAY_PICKER_CONTEXT_PUBKEY_CAP } from '@/constants'
import { filterRelaysForEventPublish } from '@/lib/relay-publish-filter'
import { collectRecipientInboxUrls, collectSenderOutboxUrls } from '@/lib/public-message-publish-relays'
import { collectRemoteReadInboxUrlsFromRelayList } from '@/lib/viewer-read-inboxes'
import { collectViewerWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import storage from '@/services/local-storage.service'
import { NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX } from '@/lib/content-patterns'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import { buildRandomPublishRelayCandidateList, normalizePublishRelayCandidate } from '@/lib/random-publish-relay-pool'
import {
  canonicalRelaySessionKey,
  isLocalNetworkUrl,
  normalizeAnyRelayUrl,
  normalizeRelayUrlByScheme
} from '@/lib/url'
import { isValidPubkey } from '@/lib/pubkey'
import { TRelayList, TRelaySet } from '@/types'
import logger from '@/lib/logger'
import indexedDb from '@/services/indexed-db.service'
import { getHttpRelayListFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import { stripLocalNetworkRelaysFromRelayList } from '@/lib/relay-list-sanitize'
import { isProtectedEvent } from '@/lib/event'
import { collectThreadReplyInboxPubkeys } from '@/lib/thread-context-relays'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { nip66Service } from '@/services/nip66.service'

export interface RelaySelectionContext {
  // User's own relays
  userWriteRelays: string[]
  /** Kind 10243 write/both targets (HTTPS index relays); labeled "HTTP" in the picker. */
  userHttpWriteRelays?: string[]
  userReadRelays: string[]
  favoriteRelays: string[]
  blockedRelays: string[]
  relaySets: TRelaySet[]
  
  // Post context
  parentEvent?: Event
  isPublicMessage?: boolean
  content?: string
  mentions?: string[] // Pre-extracted mentions (for PMs)
  userPubkey?: string
  openFrom?: string[]
  /** Random relays added to the selectable list; when setting is ON they are selected by default */
  randomRelayUrls?: string[]
}

/** Display type for a relay in the publish relay selector */
export type RelaySourceType =
  | 'local'
  | 'relay_list'
  | 'http_relay_list'
  | 'client_default'
  | 'open_from'
  | 'favorite'
  | 'relay_set'
  | 'contextual'
  | 'randomly_selected'

export interface RelaySelectionResult {
  selectableRelays: string[]
  selectedRelays: string[]
  description: string
  /** Source type per relay URL (for UI labels). */
  relayTypes: Record<string, RelaySourceType>
  /** Optional random publish relays (NIP-66 / session / write fallbacks), independent of metadata-only read policy. */
  randomRelayUrls: string[]
}

class RelaySelectionService {
  /**
   * Filter out local network relays from other users' relay lists
   * We should only use our own local relays, not other users' local relays
   */
  private normRelay(url: string): string {
    return normalizeRelayUrlByScheme(url) || url.trim()
  }

  /** Kind 10432 + 10243 + 10002 write outboxes (already merged in {@link RelaySelectionContext.userWriteRelays}). */
  private userWriteOutboxRelays(context: RelaySelectionContext): string[] {
    return dedupeNormalizeRelayUrlsOrdered(context.userWriteRelays)
  }

  /** True when the discussion thread (kind 11 parent) uses the `-` protected tag. */
  private discussionContextIsProtected(parentEvent: Event): boolean {
    return isProtectedEvent(parentEvent)
  }

  private filterLocalRelaysFromOthers(relays: string[], isOwnRelays: boolean = false): string[] {
    if (isOwnRelays) {
      // For our own relays, keep all of them including local ones
      return relays
    }
    
    // For other users' relays, filter out local network relays
    return relays.filter(relay => !isLocalNetworkUrl(relay))
  }

  /**
   * Main entry point for relay selection logic
   */
  async selectRelays(context: RelaySelectionContext): Promise<RelaySelectionResult> {
    // Step 1: Build the list of selectable relays and their source types
    const { relays: selectableRelays, relayTypes, randomRelayUrls } = await this.buildSelectableRelaysWithTypes(context)
    
    // Step 2: Determine which relays should be selected (checked)
    const contextWithRandom = { ...context, randomRelayUrls }
    const selectedRelays = await this.determineSelectedRelays(contextWithRandom)
    
    // Step 3: Generate description
    const description = this.generateDescription(selectedRelays)

    return {
      selectableRelays,
      selectedRelays,
      description,
      relayTypes,
      randomRelayUrls: contextWithRandom.randomRelayUrls ?? []
    }
  }

  /** Parent author + reply/PM mention pubkeys whose NIP-65 should be refreshed when the picker opens. */
  async collectContextRelayPubkeys(context: RelaySelectionContext): Promise<string[]> {
    const { parentEvent, isPublicMessage, content, mentions, userPubkey } = context
    if (!parentEvent && !isPublicMessage) return []

    const seen = new Set<string>()
    const out: string[] = []
    const add = (pk: string | undefined) => {
      if (!pk || !isValidPubkey(pk) || pk === userPubkey || seen.has(pk)) return
      seen.add(pk)
      out.push(pk)
    }

    if (parentEvent) {
      for (const pk of collectThreadReplyInboxPubkeys(parentEvent, userPubkey)) {
        add(pk)
      }
      if (
        userPubkey &&
        content &&
        parentEvent.kind !== ExtendedKind.PUBLIC_MESSAGE
      ) {
        const extracted = await this.extractMentions(content, parentEvent)
        extracted.forEach((pk) => add(pk))
      }
    } else if (isPublicMessage && userPubkey) {
      if (mentions && mentions.length > 0) {
        mentions.forEach((pk) => add(pk))
      } else if (content) {
        const extracted = await this.extractMentions(content, parentEvent)
        extracted.forEach((pk) => add(pk))
      }
    }

    return out.slice(0, RELAY_PICKER_CONTEXT_PUBKEY_CAP)
  }

  /** Bounded network refresh for {@link collectContextRelayPubkeys}; no-op when empty. */
  async refreshContextualRelayLists(context: RelaySelectionContext): Promise<void> {
    const pubkeys = await this.collectContextRelayPubkeys(context)
    if (pubkeys.length === 0) return
    await client.refreshContextRelayListsForPicker(pubkeys)
  }

  /**
   * Pick random publish relays for the post picker. Uses NIP-66 lively list and session stats when
   * available; falls back to {@link FAST_WRITE_RELAY_URLS} so random relays still appear when the
   * viewer restricts reads to their own relay lists (NIP-66 discovery fetch is skipped in that mode).
   */
  private async pickRandomPublishRelayUrls(existingSessionKeys: Set<string>): Promise<string[]> {
    if (typeof window === 'undefined') return []
    try {
      const sessionBoost = client.getSessionSuccessfulPublishRelayUrlsForRandomPool()
      const publicLively = await nip66Service.getPublicLivelyRelayUrls()
      const candidates = buildRandomPublishRelayCandidateList({
        excludeSessionKeys: existingSessionKeys,
        sessionBoost,
        nip66Lively: publicLively,
        fallbackWriteRelays: FAST_WRITE_RELAY_URLS
      })
      const preferred = client.getPreferredRelaysForRandom(candidates, RANDOM_PUBLISH_RELAY_COUNT)
      return preferred
        .map((url) => normalizePublishRelayCandidate(url))
        .filter((url) => url.length > 0)
    } catch {
      return []
    }
  }

  /**
   * Build the list of all relays that can be selected, with a source type for each (first source wins).
   * Always includes: user's write relays (or fast write fallback) + favorite relays + relay sets
   * Plus contextual relays for replies and public messages.
   */
  private async buildSelectableRelaysWithTypes(
    context: RelaySelectionContext
  ): Promise<{ relays: string[]; relayTypes: Record<string, RelaySourceType>; randomRelayUrls: string[] }> {
    const {
      userWriteRelays,
      userHttpWriteRelays,
      favoriteRelays,
      relaySets,
      parentEvent,
      isPublicMessage,
      openFrom
    } = context

    if (
      isPublicMessage ||
      (parentEvent != null && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE)
    ) {
      const pmRelays = await this.getPublicMessageRelays(context)
      const filtered = this.filterPublishPickerRelays(
        this.filterBlockedRelays(pmRelays, context.blockedRelays)
      )
      const relayTypes: Record<string, RelaySourceType> = {}
      const httpSet = new Set(
        (userHttpWriteRelays ?? [])
          .map((u) => canonicalRelaySessionKey(u))
          .filter(Boolean)
      )
      filtered.forEach((url) => {
        relayTypes[url] = httpSet.has(canonicalRelaySessionKey(url)) ? 'http_relay_list' : 'relay_list'
      })
      return { relays: filtered, relayTypes, randomRelayUrls: [] }
    }

    const order: { url: string; type: RelaySourceType }[] = []
    const seen = new Set<string>()

    const addRelay = (url: string, type: RelaySourceType) => {
      if (!url) return
      const normalized = normalizeRelayUrlByScheme(url)
      const key = normalized ? canonicalRelaySessionKey(normalized) : ''
      if (key && !seen.has(key)) {
        seen.add(key)
        order.push({ url: normalized, type })
      } else if (!normalized) {
        logger.warn('Skipping invalid relay URL', { url })
      }
    }

    const userHttpWrites = context.userHttpWriteRelays ?? []
    userHttpWrites.forEach((url) => addRelay(url, 'http_relay_list'))

    // User's write relays (or fallback = client default)
    const userRelays = userWriteRelays.length > 0 ? userWriteRelays : FAST_WRITE_RELAY_URLS
    const userType: RelaySourceType = userWriteRelays.length > 0 ? 'relay_list' : 'client_default'
    userRelays.forEach((url) => addRelay(url, userType))

    // Cache relays (local) – may duplicate user write; only add if not already present
    const cacheRelays = userWriteRelays.filter((url) => isLocalNetworkUrl(url))
    cacheRelays.forEach((url) => addRelay(url, 'local'))

    favoriteRelays.forEach((url) => addRelay(url, 'favorite'))

    relaySets.forEach((set) => {
      set.relayUrls.forEach((url) => addRelay(url, 'relay_set'))
    })

    if (parentEvent || isPublicMessage) {
      const contextualRelays = await this.getContextualRelays(context)
      contextualRelays.forEach((url) => addRelay(url, 'contextual'))
    }

    if (openFrom && openFrom.length > 0) {
      openFrom.forEach((url) => addRelay(url, 'open_from'))
    }

    const existingSessionKeys = new Set(
      order.map((o) => canonicalRelaySessionKey(o.url)).filter(Boolean)
    )
    const randomRelayUrls = await this.pickRandomPublishRelayUrls(existingSessionKeys)
    randomRelayUrls.forEach((url) => {
      addRelay(url, 'randomly_selected')
    })

    const deduplicatedRelays = order.map((o) => o.url)
    const filtered = this.filterPickerRelaysKeepingOpenFrom(
      deduplicatedRelays,
      context.blockedRelays,
      openFrom
    )
    const relayTypes: Record<string, RelaySourceType> = {}
    order.forEach(({ url, type }) => {
      if (filtered.includes(url)) relayTypes[url] = type
    })
    return {
      relays: filtered,
      relayTypes,
      randomRelayUrls: this.filterPublishPickerRelays(randomRelayUrls)
    }
  }

  /**
   * Validate that a URL is a valid, non-empty relay URL
   */
  private isValidRelayUrl(url: string | undefined | null): url is string {
    return !!(url && typeof url === 'string' && url.trim() !== '' && url !== 'ws://' && url !== 'wss://')
  }

  /**
   * Get relay list from IndexedDB cache (kind 10002 and 10432 merged)
   * If not in cache, fetch from relays before returning empty
   * This avoids fetching from relays every time, but ensures we have data when needed
   */
  private async getCachedRelayList(pubkey: string): Promise<TRelayList | null> {
    try {
      // Get kind 10002, 10432, and 10243 from IndexedDB
      const [relayListEvent, cacheRelayListEvent, httpRelayListEvent] = await Promise.all([
        indexedDb.getReplaceableEvent(pubkey, kinds.RelayList),
        indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS),
        indexedDb.getReplaceableEvent(pubkey, ExtendedKind.HTTP_RELAY_LIST)
      ])

      const mergeKind10243 = (list: TRelayList): TRelayList => {
        const h = getHttpRelayListFromEvent(httpRelayListEvent ?? undefined)
        return { ...list, httpRead: h.httpRead, httpWrite: h.httpWrite, httpOriginalRelays: h.httpOriginalRelays }
      }

      let relayList: TRelayList

      // If no cached relay list event, fetch from relays (which will also cache it)
      if (!relayListEvent) {
        try {
          relayList = await Promise.race([
            client.fetchRelayList(pubkey),
            new Promise<TRelayList>((resolve) =>
              setTimeout(
                () =>
                  resolve(
                    mergeKind10243({
                      write: [],
                      read: [],
                      originalRelays: [],
                      httpRead: [],
                      httpWrite: [],
                      httpOriginalRelays: []
                    })
                  ),
                PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS
              )
            )
          ])
        } catch (error) {
          logger.warn('Failed to fetch relay list from relays', { error, pubkey })
          relayList = mergeKind10243({
            write: [],
            read: [],
            originalRelays: [],
            httpRead: [],
            httpWrite: [],
            httpOriginalRelays: []
          })
        }
      } else {
        relayList = mergeKind10243(
          stripLocalNetworkRelaysFromRelayList(getRelayListFromEvent(relayListEvent))
        )
      }

      // Merge cache relays (kind 10432) into the relay list
      if (cacheRelayListEvent) {
        const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
        
        // Filter out invalid/empty URLs before merging
        const validCacheRead = cacheRelayList.read.filter(this.isValidRelayUrl)
        const validCacheWrite = cacheRelayList.write.filter(this.isValidRelayUrl)
        const validRelayRead = relayList.read.filter(this.isValidRelayUrl)
        const validRelayWrite = relayList.write.filter(this.isValidRelayUrl)
        
        // Merge read relays - cache relays first, then others
        const mergedRead = [...validCacheRead, ...validRelayRead]
        const mergedWrite = [...validCacheWrite, ...validRelayWrite]
        const mergedOriginalRelays = new Map<string, { url: string; scope: 'read' | 'write' | 'both' }>()
        
        // Add cache relay original relays first (prioritized)
        cacheRelayList.originalRelays.forEach(relay => {
          mergedOriginalRelays.set(relay.url, relay)
        })
        // Then add regular relay original relays
        relayList.originalRelays.forEach(relay => {
          if (!mergedOriginalRelays.has(relay.url)) {
            mergedOriginalRelays.set(relay.url, relay)
          }
        })
        
        // Deduplicate while preserving order (cache relays first)
        return {
          write: Array.from(new Set(mergedWrite)),
          read: Array.from(new Set(mergedRead)),
          originalRelays: Array.from(mergedOriginalRelays.values()),
          httpRead: relayList.httpRead,
          httpWrite: relayList.httpWrite,
          httpOriginalRelays: relayList.httpOriginalRelays
        }
      }

      return relayList
    } catch (error) {
      logger.warn('Failed to get cached relay list from IndexedDB', { error, pubkey })
      return null
    }
  }

  /**
   * Get contextual relays based on the type of post
   */
  private async getContextualRelays(context: RelaySelectionContext): Promise<string[]> {
    const { parentEvent, isPublicMessage, content, userPubkey } = context
    const contextualRelays = new Set<string>()


    try {
      // For replies (any kind) and public messages
      if (parentEvent || isPublicMessage) {
        // Get the replied-to author's read relays (filter out their local relays)
        // Use cached version from IndexedDB instead of fetching from relays
        if (parentEvent) {
          for (const pubkey of collectThreadReplyInboxPubkeys(parentEvent, userPubkey)) {
            const authorRelayList = await this.getCachedRelayList(pubkey)
            if (authorRelayList) {
              const filteredRelays = this.filterLocalRelaysFromOthers(
                collectRemoteReadInboxUrlsFromRelayList(authorRelayList)
              )
              filteredRelays.slice(0, 4).forEach(url => contextualRelays.add(url))
            }
          }
        }

        // Get relay hint from where the event was discovered
        if (parentEvent) {
          const eventHints = client.getEventHints(parentEvent.id)
          eventHints.forEach(url => contextualRelays.add(url))
        }

        // For replies and public messages, get mentioned users' relays
        if (userPubkey) {
          let mentions: string[] = parentEvent
            ? collectThreadReplyInboxPubkeys(parentEvent, userPubkey)
            : []
          
          // Extract additional mentions from content if available
          if (content) {
            const contentMentions = await this.extractMentions(content, parentEvent)
            mentions = [...new Set([...mentions, ...contentMentions])] // deduplicate
          }
          
          const mentionedPubkeys = mentions.filter(p => p !== userPubkey)
          
          
          if (mentionedPubkeys.length > 0) {
            const mentionRelayLists = await Promise.all(
              mentionedPubkeys.map(async (pubkey) => {
                try {
                  // Use cached version from IndexedDB instead of fetching from relays
                  const relayList = await this.getCachedRelayList(pubkey)
                  if (!relayList) return []
                  // Use write relays for replies, read relays for public messages
                  const relayType = isPublicMessage ? 'read' : 'write'
                  const userRelays = relayList[relayType] || []
                  // Filter out local relays from other users
                  return this.filterLocalRelaysFromOthers(userRelays)
                } catch (error) {
                  logger.warn('Failed to get cached relay list', { pubkey, error })
                  return []
                }
              })
            )
            mentionRelayLists.flat().forEach(url => contextualRelays.add(url))
          }
        }
      }
    } catch (error) {
      logger.error('Failed to get contextual relays', { error })
    }

    return Array.from(contextualRelays)
  }

  /**
   * Determine which relays should be selected (checked) based on the context
   */
  private async determineSelectedRelays(
    context: RelaySelectionContext
  ): Promise<string[]> {
    const {
      parentEvent,
      isPublicMessage,
      openFrom,
      content,
      userPubkey
    } = context

    let selectedRelays: string[] = []

    const userOutboxes = this.userWriteOutboxRelays(context)
    const defaultOutboxes = userOutboxes.length > 0 ? userOutboxes : FAST_WRITE_RELAY_URLS

    // If called with specific relay URLs, use those
    if (openFrom && openFrom.length > 0) {
      selectedRelays = Array.from(new Set(openFrom.map((url) => this.normRelay(url)).filter(Boolean)))
    }
    // For discussion replies, use relay hints from the kind 11 + user's outboxes + local relays + thecitadel
    else if (parentEvent && (parentEvent.kind === ExtendedKind.DISCUSSION || parentEvent.kind === ExtendedKind.COMMENT)) {
      selectedRelays = await this.getDiscussionReplyRelays(context)
    }
    // For public messages, use sender outboxes + receiver inboxes only
    else if (isPublicMessage || (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE)) {
      selectedRelays = await this.getPublicMessageRelays(context)
      return this.filterPublishPickerRelays(this.filterBlockedRelays(selectedRelays, context.blockedRelays))
    }
    // For regular replies, use user's write relays + mention relays
    else if (parentEvent && this.isRegularReply(parentEvent)) {
      selectedRelays = Array.from(new Set(defaultOutboxes.map((url) => this.normRelay(url)).filter(Boolean)))

      // Add mention relays
      if (userPubkey) {
        let mentions: string[] = parentEvent
          ? collectThreadReplyInboxPubkeys(parentEvent, userPubkey)
          : []
        if (content) {
          const contentMentions = await this.extractMentions(content, parentEvent)
          mentions = [...new Set([...mentions, ...contentMentions])]
        }
        const mentionedPubkeys = mentions.filter(p => p !== userPubkey)
        if (mentionedPubkeys.length > 0) {
          const mentionRelayLists = await Promise.all(
            mentionedPubkeys.map(async (pubkey) => {
              try {
                const relayList = await this.getCachedRelayList(pubkey)
                if (!relayList) return []
                return this.filterLocalRelaysFromOthers(collectSenderOutboxUrls(relayList))
              } catch (error) {
                logger.warn('Failed to get cached relay list', { pubkey, error })
                return []
              }
            })
          )
          const mentionRelays = mentionRelayLists.flat().map((url) => this.normRelay(url)).filter(Boolean)
          selectedRelays = Array.from(new Set([...selectedRelays, ...mentionRelays]))
        }
      }
    }
    // Default: user's write relays (or fallback to fast write relays if no user relays)
    else {
      selectedRelays = Array.from(new Set(defaultOutboxes.map((url) => this.normRelay(url)).filter(Boolean)))
    }

    // ALWAYS include cache relays (local network relays) in selected relays
    const cacheRelays = context.userWriteRelays.filter(url => isLocalNetworkUrl(url))
    if (cacheRelays.length > 0) {
      selectedRelays = Array.from(new Set([...selectedRelays, ...cacheRelays.map((url) => this.normRelay(url)).filter(Boolean)]))
    }

    // When "add random relays" setting is ON, include random relays in selected by default; when OFF
    // they remain in the list but unchecked. Skip entirely when an explicit publish target (openFrom)
    // is set — e.g. "Share something on this relay" must preselect only that relay, not random relays.
    if (
      context.randomRelayUrls?.length &&
      storage.getAddRandomRelaysToPublish() &&
      !(openFrom && openFrom.length > 0)
    ) {
      selectedRelays = [...selectedRelays, ...context.randomRelayUrls]
      selectedRelays = Array.from(new Set(selectedRelays))
    }

    return this.filterPickerRelaysKeepingOpenFrom(
      selectedRelays,
      context.blockedRelays,
      openFrom
    )
  }

  /**
   * Get relays for public messages: sender outboxes + receiver inboxes
   * Only includes outboxes from sender and inboxes from all recipients
   * Normalized and deduplicated. If more than 10, limits to one per member,
   * preferring relays that multiple people have.
   */
  private async getPublicMessageRelays(context: RelaySelectionContext): Promise<string[]> {
    const { userWriteRelays, parentEvent, isPublicMessage, content, mentions, userPubkey } = context
    
    // Map to track which relays belong to which members
    const relayToMembers = new Map<string, Set<string>>()
    const allMembers = new Set<string>()

    try {
      // Get sender's outboxes (write + HTTP write relays)
      if (userPubkey) {
        allMembers.add(userPubkey)
        let senderRelays = collectSenderOutboxUrls(
          null,
          [...(context.userHttpWriteRelays ?? []), ...userWriteRelays]
        )
        if (senderRelays.length === 0) {
          try {
            const userRelayList = await this.getCachedRelayList(userPubkey)
            if (userRelayList) {
              senderRelays = await collectViewerWriteOutboxUrls(userPubkey, userRelayList)
            }
          } catch (error) {
            logger.warn('Failed to fetch user relay list for PM', { error, userPubkey })
          }
        }

        senderRelays.forEach(url => {
          const normalized = this.normRelay(url)
          if (!normalized) return
          if (!relayToMembers.has(normalized)) {
            relayToMembers.set(normalized, new Set())
          }
          relayToMembers.get(normalized)!.add(userPubkey)
        })
      }

      // Get recipients and their inboxes (read relays)
      let recipientPubkeys: string[] = []
      
      if (isPublicMessage && userPubkey) {
        // For new public messages, use provided mentions or extract from content
        if (mentions && mentions.length > 0) {
          recipientPubkeys = mentions.filter(p => p !== userPubkey)
        } else if (content) {
          // Fallback to extracting from content if mentions not provided
          const extractedMentions = await this.extractMentions(content, parentEvent)
          recipientPubkeys = extractedMentions.filter(p => p !== userPubkey)
        }
      } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
        // For public message replies, get all recipients from parent event
        // Include original sender and all p tags
        recipientPubkeys = [parentEvent.pubkey]
        parentEvent.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'p' && tagValue && tagValue !== userPubkey) {
            recipientPubkeys.push(tagValue)
          }
        })
        // Deduplicate
        recipientPubkeys = Array.from(new Set(recipientPubkeys))
      }

      // Fetch read relays (inboxes) for all recipients
      if (recipientPubkeys.length > 0) {
        const recipientRelayLists = await Promise.all(
          recipientPubkeys.map(async (pubkey) => {
            try {
              allMembers.add(pubkey)
              // Use cached version from IndexedDB
              const relayList = await this.getCachedRelayList(pubkey)
              if (!relayList) return []
              return this.filterLocalRelaysFromOthers(collectRecipientInboxUrls(relayList))
            } catch (error) {
              logger.warn('Failed to fetch relay list', { pubkey, error })
              return []
            }
          })
        )

        // Track which relays belong to which recipients
        recipientRelayLists.forEach((relays, index) => {
          const pubkey = recipientPubkeys[index]
          relays.forEach(url => {
            const normalized = this.normRelay(url)
            if (!normalized) return
            if (!relayToMembers.has(normalized)) {
              relayToMembers.set(normalized, new Set())
            }
            relayToMembers.get(normalized)!.add(pubkey)
          })
        })
      }

      // Build final relay list
      const relays: string[] = []
      
      // If we have 10 or fewer relays, use all of them
      if (relayToMembers.size <= 10) {
        relays.push(...Array.from(relayToMembers.keys()))
      } else {
        // More than 10 relays - need to limit to one per member
        // Prefer relays that multiple people have
        
        // Sort relays by number of members (descending), then by URL for stability
        const sortedRelays = Array.from(relayToMembers.entries())
          .sort((a, b) => {
            const aCount = a[1].size
            const bCount = b[1].size
            if (aCount !== bCount) {
              return bCount - aCount // Prefer relays with more members
            }
            return a[0].localeCompare(b[0]) // Stable sort by URL
          })

        // Track which members already have a relay selected
        const selectedForMember = new Map<string, string>()
        
        // First pass: assign relays that multiple people have
        for (const [relayUrl, members] of sortedRelays) {
          if (members.size > 1) {
            // This relay is used by multiple people - add it
            relays.push(relayUrl)
            // Mark all members as having a relay
            members.forEach(member => {
              selectedForMember.set(member, relayUrl)
            })
          }
        }
        
        // Second pass: ensure each member has at least one relay
        for (const [relayUrl, members] of sortedRelays) {
          if (relays.length >= 10) break
          
          // Check if any member still needs a relay
          const needsRelay = Array.from(members).some(member => !selectedForMember.has(member))
          if (needsRelay) {
            relays.push(relayUrl)
            members.forEach(member => {
              if (!selectedForMember.has(member)) {
                selectedForMember.set(member, relayUrl)
              }
            })
          }
        }
      }

      // Normalize and deduplicate final list
      const normalizedRelays = relays
        .map((url) => this.normRelay(url))
        .filter((url): url is string => !!url)
      
      return Array.from(new Set(normalizedRelays))
    } catch (error) {
      logger.error('Failed to get public message relays', { error, parentEvent: context.parentEvent?.id })
      return collectSenderOutboxUrls(null, [
        ...(context.userHttpWriteRelays ?? []),
        ...userWriteRelays
      ])
    }
  }


  /**
   * Check if this is a regular reply (Kind 1 or Kind 1111, not to Kind 11)
   */
  private isRegularReply(parentEvent: Event): boolean {
    return (parentEvent.kind === kinds.ShortTextNote || parentEvent.kind === ExtendedKind.COMMENT) &&
           parentEvent.kind !== ExtendedKind.DISCUSSION
  }

  /**
   * Get all relay hints from a kind 11 discussion event
   * Returns all relays where the event was seen (excluding local relays)
   */
  private getDiscussionRelayHints(discussionEventId: string): string[] {
    const eventHints = client.getEventHints(discussionEventId)
    return eventHints.map(url => normalizeAnyRelayUrl(url) || url).filter(Boolean)
  }

  /**
   * Get relays for discussion replies (kind 11 or kind 1111)
   * Includes: relay hints from kind 11, wss://thecitadel.nostr1.com, user's outboxes, and local relays.
   * Protected threads (`-` tag on kind 11): hints + citadel + cache only — general outboxes reject protected events.
   */
  private async getDiscussionReplyRelays(context: RelaySelectionContext): Promise<string[]> {
    const { parentEvent, userPubkey, blockedRelays } = context
    if (!parentEvent) return []

    const relayUrls = new Set<string>()
    const threadIsProtected = this.discussionContextIsProtected(parentEvent)
    const userOutboxes = threadIsProtected ? [] : this.userWriteOutboxRelays(context)

    // Step 1: Get relay hints from the kind 11 event
    let discussionEventId: string | null = null
    
    if (parentEvent.kind === ExtendedKind.COMMENT) {
      // For kind 1111 (COMMENT): get root kind 11 event ID from E tag
      const ETag = parentEvent.tags.find(tag => tag[0] === 'E')
      if (ETag && ETag[1]) {
        discussionEventId = ETag[1]
      } else {
        // Fallback to lowercase e tag
        const eTag = parentEvent.tags.find(tag => tag[0] === 'e')
        if (eTag && eTag[1]) {
          discussionEventId = eTag[1]
        }
      }
    } else if (parentEvent.kind === ExtendedKind.DISCUSSION) {
      // For kind 11 (DISCUSSION): use the event itself
      discussionEventId = parentEvent.id
    }

    // Get all relay hints from the kind 11 event
    if (discussionEventId) {
      const discussionHints = this.getDiscussionRelayHints(discussionEventId)
      discussionHints.forEach(url => relayUrls.add(url))
    }

    // Step 2: Add wss://thecitadel.nostr1.com
    const thecitadelUrl = normalizeAnyRelayUrl('wss://thecitadel.nostr1.com')
    if (thecitadelUrl) {
      relayUrls.add(thecitadelUrl)
    }

    // Step 3: User outboxes (skip for protected threads — most public relays reject `-` events)
    if (!threadIsProtected) {
      if (userOutboxes.length > 0) {
        userOutboxes.forEach((url) => {
          const normalized = this.normRelay(url)
          if (normalized) relayUrls.add(normalized)
        })
      } else if (userPubkey) {
        try {
          const relayList = await this.getCachedRelayList(userPubkey)
          if (relayList) {
            const outboxes = await collectViewerWriteOutboxUrls(userPubkey, relayList)
            outboxes.forEach((url) => {
              const normalized = this.normRelay(url)
              if (normalized) relayUrls.add(normalized)
            })
          }
        } catch (error) {
          logger.warn('Failed to fetch user relay list for discussion reply', { error, userPubkey })
        }
      }
    }

    // Step 4: Add local relays (cache relays from kind 10432)
    if (userPubkey) {
      try {
        const cacheRelayEvent = await indexedDb.getReplaceableEvent(userPubkey, ExtendedKind.CACHE_RELAYS)
        if (cacheRelayEvent) {
          cacheRelayEvent.tags.forEach(tag => {
            if (tag[0] === 'relay' && tag[1]) {
              const normalized = normalizeAnyRelayUrl(tag[1])
              if (normalized) {
                relayUrls.add(normalized)
              }
            }
          })
        }
      } catch (error) {
        logger.warn('Failed to fetch cache relays for discussion reply', { error, userPubkey })
      }
    }

    // Step 5: Convert to array, normalize, and deduplicate
    const normalizedRelays = Array.from(relayUrls)
      .map((url) => this.normRelay(url))
      .filter((url): url is string => !!url)

    const deduplicatedRelays = Array.from(new Set(normalizedRelays))

    // Step 6: Filter out blocked relays
    return this.filterBlockedRelays(deduplicatedRelays, blockedRelays)
  }

  /**
   * Extract mentions from content (simplified version of the existing extractMentions)
   */
  private async extractMentions(content: string, parentEvent?: Event): Promise<string[]> {
    const pubkeys: string[] = []
    
    if (parentEvent) {
      for (const pk of collectThreadReplyInboxPubkeys(parentEvent)) {
        if (!pubkeys.includes(pk)) pubkeys.push(pk)
      }
    }
    
    // Extract nostr addresses from content
    const matches = content.match(NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX)


    if (matches) {
      for (const match of matches) {
        try {
          const { nip19 } = await import('nostr-tools')
          const id = match.split(':')[1]
          const { type, data } = nip19.decode(id)
          if (type === 'nprofile') {
            if (!pubkeys.includes(data.pubkey)) {
              pubkeys.push(data.pubkey)
            }
          } else if (type === 'npub') {
            if (!pubkeys.includes(data)) {
              pubkeys.push(data)
            }
          } else if (['nevent', 'note'].includes(type)) {
            const event = await eventService.fetchEvent(id)
            if (event && !pubkeys.includes(event.pubkey)) {
              pubkeys.push(event.pubkey)
            }
          }
        } catch (error) {
          logger.error('Failed to decode nostr address', { error, match })
        }
      }
    }

    // Add related pubkeys from parent event tags
    if (parentEvent) {
      parentEvent.tags.forEach(([tagName, tagValue]) => {
        if (['p', 'P'].includes(tagName) && tagValue && !pubkeys.includes(tagValue)) {
          pubkeys.push(tagValue)
        }
      })
    }

    return pubkeys
  }

  /**
   * Generate description for the selected relays
   */
  private generateDescription(selectedRelays: string[]): string {
    if (selectedRelays.length === 0) {
      return 'No relays selected'
    }
    if (selectedRelays.length === 1) {
      return this.simplifyUrl(selectedRelays[0])
    }
    return `${selectedRelays.length} relays`
  }

  /**
   * Simplify URL for display
   */
  private simplifyUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname
    } catch {
      return url
    }
  }

  /**
   * Strip read-only aggregators and profile/index mirrors from the post/reaction publish picker
   * (notes and reactions are not kind 0 / NIP-65 list traffic).
   */
  private filterPublishPickerRelays(relays: string[]): string[] {
    return filterRelaysForEventPublish(relays, kinds.ShortTextNote)
  }

  /**
   * Apply the blocked-relay + publish-picker (read-only / social-kind) filters, but ALWAYS keep relays the
   * caller explicitly targeted via {@link RelaySelectionContext.openFrom} (e.g. "Share something on this
   * relay" in single-relay view). An explicit target overrides every block — read-only, profile-index,
   * social-kind-blocked, and the viewer's own kind-10006 blocked list — so an admin can always post there.
   */
  private filterPickerRelaysKeepingOpenFrom(
    relays: string[],
    blockedRelays: string[],
    openFrom?: string[]
  ): string[] {
    const allowed = new Set(
      this.filterPublishPickerRelays(this.filterBlockedRelays(relays, blockedRelays))
    )
    if (!openFrom || openFrom.length === 0) {
      return relays.filter((url) => allowed.has(url))
    }
    const exemptKeys = new Set(
      openFrom
        .map((url) => canonicalRelaySessionKey(normalizeRelayUrlByScheme(url) || url))
        .filter(Boolean)
    )
    return relays.filter(
      (url) => allowed.has(url) || exemptKeys.has(canonicalRelaySessionKey(url))
    )
  }

  /**
   * Filter out blocked relays from a list
   */
  private filterBlockedRelays(relays: string[], blockedRelays: string[]): string[] {
    if (!blockedRelays || blockedRelays.length === 0) {
      return relays
    }

    const safeNormalize = (url: string): string => this.normRelay(url)

    const normalizedBlocked = blockedRelays.map(safeNormalize)
    return relays.filter(relay => {
      const normalizedRelay = safeNormalize(relay)
      return !normalizedBlocked.includes(normalizedRelay)
    })
  }
}

const relaySelectionService = new RelaySelectionService()
export default relaySelectionService
