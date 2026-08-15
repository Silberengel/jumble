import { ExtendedKind, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, POLL_TYPE } from '@/constants'
import { TEmoji, TMailboxRelay, TPollType, TRelayList, TRelaySet, TPaymentInfo, TProfile } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { buildATag } from './draft-event'
import {
  gutenbergCoverImageUrl,
  gutenbergEbookPageUrl,
  normalizeGutenbergCoverImageUrl,
  parseGutenbergEbookIdFromDTag,
  resolveGutenbergCoverImageUrl
} from './gutenberg-cover'
import { getLatestEvent, getReplaceableEventIdentifier } from './event'
import { orderedPublicationRefsFromIndex } from './publication-asciidoc-assembler'
import { getAmountFromInvoice, getLightningAddressFromProfile } from './lightning'
import { formatPubkey, pubkeyToNpub } from './pubkey'
import { generateBech32IdFromATag, generateBech32IdFromETag, getImetaInfoFromImetaTag, tagNameEquals } from './tag'
import { isRelayBlockedByUser } from '@/lib/relay-blocked'
import {
  isKind10243HttpRelayTagUrl,
  isWebsocketUrl,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  normalizeHttpUrl,
  normalizeUrl
} from './url'
import logger from '@/lib/logger'
import { buildPaytoUri } from '@/lib/payto'
import { getCanonicalPaytoType, getPaytoEditorTypeLabel } from '@/lib/payto-registry'
import { expandIdentifier } from '@/lib/identifier-expander'

const emptyHttpRelayListFields = {
  httpRead: [] as string[],
  httpWrite: [] as string[],
  httpOriginalRelays: [] as TMailboxRelay[]
}

export type GetRelayListFromEventOptions = {
  /**
   * When false, never substitute {@link FAST_READ_RELAY_URLS} / {@link FAST_WRITE_RELAY_URLS} for missing or
   * oversized lists (use `[]` or the first 8 entries instead). Default true for anonymous / bootstrap callers.
   */
  globalReadWriteFallback?: boolean
}

function filterDefaultRelayUrls(urls: readonly string[], blockedRelays?: readonly string[]): string[] {
  if (!blockedRelays?.length) return [...urls]
  return urls.filter((url) => !isRelayBlockedByUser(url, blockedRelays))
}

/**
 * Merge kind-10432 (cache relays) from a network fetch with IndexedDB for session hydrate.
 * Some mirrors return an empty or malformed 10432 with a newer `created_at` than good local data; prefer any
 * candidate that still parses to at least one `r` WebSocket URL, then newest by time.
 */
export function mergeHydratedCacheRelayListEvents(
  fetchedEvents: Event[],
  stored: Event | undefined | null
): Event | null {
  const fromFetch = fetchedEvents.length ? getLatestEvent(fetchedEvents) : undefined
  const candidates = [fromFetch, stored ?? undefined].filter((e): e is Event => Boolean(e))
  if (candidates.length === 0) return null
  const relayRowCount = (e: Event) =>
    getRelayListFromEvent(e, undefined, { globalReadWriteFallback: false }).originalRelays.length
  const withRelays = candidates.filter((e) => relayRowCount(e) > 0)
  const pool = withRelays.length > 0 ? withRelays : candidates
  return pool.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]!
}

/**
 * Merge kind-10243 (HTTP relays) from a network fetch with IndexedDB for session hydrate.
 * Some mirrors return an empty or malformed 10243 with a newer `created_at` than good local data; prefer any
 * candidate that still parses to at least one http(s) `r` tag, then newest by time.
 */
export function mergeHydratedHttpRelayListEvents(
  fetchedEvents: Event[],
  stored: Event | undefined | null
): Event | null {
  const fromFetch = fetchedEvents.length ? getLatestEvent(fetchedEvents) : undefined
  const candidates = [fromFetch, stored ?? undefined].filter((e): e is Event => Boolean(e))
  if (candidates.length === 0) return null
  const relayRowCount = (e: Event) => getHttpRelayListFromEvent(e).httpOriginalRelays.length
  const withRelays = candidates.filter((e) => relayRowCount(e) > 0)
  const pool = withRelays.length > 0 ? withRelays : candidates
  return pool.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]!
}

export function getRelayListFromEvent(
  event?: Event | null,
  blockedRelays?: string[],
  options?: GetRelayListFromEventOptions
) {
  const globalFb = options?.globalReadWriteFallback !== false

  if (!event) {
    if (!globalFb) {
      return {
        write: [] as string[],
        read: [] as string[],
        originalRelays: [] as TRelayList['originalRelays'],
        ...emptyHttpRelayListFields
      }
    }
    return {
      write: filterDefaultRelayUrls(FAST_WRITE_RELAY_URLS, blockedRelays),
      read: filterDefaultRelayUrls(FAST_READ_RELAY_URLS, blockedRelays),
      originalRelays: [],
      ...emptyHttpRelayListFields
    }
  }

  const relayList = { write: [], read: [], originalRelays: [] } as Pick<TRelayList, 'write' | 'read' | 'originalRelays'>

  event.tags.filter(tagNameEquals('r')).forEach(([, url, type]) => {
    // Filter out empty, invalid, or malformed URLs
    if (!url || typeof url !== 'string' || url.trim() === '' || url === 'ws://' || url === 'wss://') return
    if (!isWebsocketUrl(url)) return

    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) return
    
    if (isRelayBlockedByUser(normalizedUrl, blockedRelays)) return

    const scope = type === 'read' ? 'read' : type === 'write' ? 'write' : 'both'
    relayList.originalRelays.push({ url: normalizedUrl, scope })

    if (type === 'write') {
      relayList.write.push(normalizedUrl)
    } else if (type === 'read') {
      relayList.read.push(normalizedUrl)
    } else {
      relayList.write.push(normalizedUrl)
      relayList.read.push(normalizedUrl)
    }
  })

  // If there are too many relays, use the default inbox/outbox relays.
  // Because they don't know anything about relays, their settings cannot be trusted
  const readOut =
    relayList.read.length && relayList.read.length <= 8
      ? relayList.read
      : globalFb
        ? filterDefaultRelayUrls(FAST_READ_RELAY_URLS, blockedRelays)
        : relayList.read.slice(0, 8)
  const writeOut =
    relayList.write.length && relayList.write.length <= 8
      ? relayList.write
      : globalFb
        ? filterDefaultRelayUrls(FAST_WRITE_RELAY_URLS, blockedRelays)
        : relayList.write.slice(0, 8)
  return {
    write: writeOut,
    read: readOut,
    originalRelays: relayList.originalRelays,
    ...emptyHttpRelayListFields
  }
}

/**
 * Read-side `r` tags from a relay list event (e.g. kind 10012) without {@link FAST_READ_RELAY_URLS} fallback
 * when the list is empty or oversized — for strict viewer-owned REQ stacks.
 */
export function getRelayListReadFromEventNoFastFallback(
  event: Event | null | undefined,
  blockedRelays?: string[]
): string[] {
  if (!event) return []

  const read: string[] = []

  event.tags.filter(tagNameEquals('r')).forEach(([, url, type]) => {
    if (!url || typeof url !== 'string' || url.trim() === '' || url === 'ws://' || url === 'wss://') return
    if (!isWebsocketUrl(url)) return

    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) return
    if (isRelayBlockedByUser(normalizedUrl, blockedRelays)) return

    if (type === 'write') return
    if (type === 'read') {
      read.push(normalizedUrl)
    } else {
      read.push(normalizedUrl)
    }
  })

  if (read.length === 0) return []
  if (read.length <= 8) return read
  return read.slice(0, 8)
}

/** Kind 10243: `r` tags with http(s) URLs only; same read/write/both semantics as NIP-65. */
export function getHttpRelayListFromEvent(event?: Event | null, blockedRelays?: string[]) {
  const out = {
    httpRead: [] as string[],
    httpWrite: [] as string[],
    httpOriginalRelays: [] as TMailboxRelay[]
  }
  if (!event) return out

  event.tags.filter(tagNameEquals('r')).forEach(([, url, type]) => {
    if (!url || typeof url !== 'string' || url.trim() === '') return
    if (!isKind10243HttpRelayTagUrl(url)) return

    const normalizedUrl = normalizeHttpRelayUrl(url)
    if (!normalizedUrl) return

    if (isRelayBlockedByUser(normalizedUrl, blockedRelays)) return

    const scope = type === 'read' ? 'read' : type === 'write' ? 'write' : 'both'
    out.httpOriginalRelays.push({ url: normalizedUrl, scope })

    if (type === 'write') {
      out.httpWrite.push(normalizedUrl)
    } else if (type === 'read') {
      out.httpRead.push(normalizedUrl)
    } else {
      out.httpWrite.push(normalizedUrl)
      out.httpRead.push(normalizedUrl)
    }
  })

  return {
    httpRead: Array.from(new Set(out.httpRead)),
    httpWrite: Array.from(new Set(out.httpWrite)),
    httpOriginalRelays: out.httpOriginalRelays
  }
}

/** Kind 0 JSON `nip05` may be a string or string[]; tags are always strings. */
function firstNip05StringFromJson(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t || undefined
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string') {
        const t = x.trim()
        if (t) return t
      }
    }
  }
  return undefined
}

function nip05ListFromJson(raw: unknown): string[] | undefined {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  if (typeof raw === 'string') add(raw)
  else if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string') add(x)
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Kind-0 metadata: profile is marked as a bot when there is `["bot"]` or `["bot","true"]`
 * (case-insensitive tag name and value) and no `["bot","false"]` tag.
 */
export function profileIsBotFromKind0Tags(tags: string[][]): boolean {
  let hasFalse = false
  let hasAffirmative = false
  for (const raw of tags) {
    if (!Array.isArray(raw) || !raw.length) continue
    if (String(raw[0]).toLowerCase() !== 'bot') continue
    if (raw.length === 1) {
      hasAffirmative = true
      continue
    }
    const v = String(raw[1] ?? '').toLowerCase()
    if (v === 'false') hasFalse = true
    else if (v === 'true') hasAffirmative = true
  }
  if (hasFalse) return false
  return hasAffirmative
}

export function getProfileFromEvent(event: Event) {
  // Parse JSON content as fallback
  let profileObj: any = {}
  try {
    profileObj = JSON.parse(event.content || '{}')
  } catch (err) {
    logger.error('Failed to parse event metadata JSON', { error: err, content: event.content })
  }

  // Extract values from tags (preferred over JSON content)
  const nip05Tags = event.tags.filter(tag => tag[0] === 'nip05' && tag[1]).map(tag => tag[1])
  const websiteTags = event.tags.filter(tag => tag[0] === 'website' && tag[1]).map(tag => tag[1])
  const lud06Tags = event.tags.filter(tag => tag[0] === 'lud06' && tag[1]).map(tag => tag[1])
  const lud16Tags = event.tags.filter(tag => tag[0] === 'lud16' && tag[1]).map(tag => tag[1])

  /** `["w", currency, address, network]` — multi-wallet hints on kind 0 */
  const wWalletTags = event.tags
    .filter((tag): tag is string[] => tag[0] === 'w' && !!tag[1] && !!tag[2] && !!tag[3])
    .map((tag) => ({
      currency: String(tag[1]).trim(),
      address: String(tag[2]).trim(),
      network: String(tag[3]).trim().toLowerCase()
    }))
    .filter((w) => w.address && w.network)
  const wLightningAddresses = wWalletTags.filter((w) => w.network === 'lightning').map((w) => w.address)
  
  // Use first tag entry for single values, or fallback to JSON
  const nip05 =
    nip05Tags.length > 0 ? nip05Tags[0] : firstNip05StringFromJson(profileObj.nip05)
  const nip05List =
    nip05Tags.length > 0 ? nip05Tags : nip05ListFromJson(profileObj.nip05)
  
  const website = websiteTags.length > 0 
    ? normalizeHttpUrl(websiteTags[0]) 
    : (profileObj.website ? normalizeHttpUrl(profileObj.website) : undefined)
  const websiteList = websiteTags.length > 0 
    ? websiteTags.map(w => normalizeHttpUrl(w))
    : (profileObj.website ? [normalizeHttpUrl(profileObj.website)] : undefined)
  
  // Use FIRST lightning tag from kind 0 only (for zap button - do not use subsequent tags or kind 10133)
  const lud06 = lud06Tags.length > 0 ? lud06Tags[0] : profileObj.lud06
  const lud16 = lud16Tags.length > 0 ? lud16Tags[0] : profileObj.lud16
  
  // Build lightning address from FIRST tag or JSON (prefer first tag, fallback to JSON)
  // This is used by the zap button and should only come from kind 0, not kind 10133 payto
  const lightningAddressFromTags = lud16 || lud06 || wLightningAddresses[0]
  const lightningAddressFromJson = getLightningAddressFromProfile({ lud06: profileObj.lud06, lud16: profileObj.lud16 } as TProfile)
  const lightningAddress = lightningAddressFromTags || lightningAddressFromJson
  
  // Build list of all lightning addresses (from tags first, then JSON)
  const lightningAddressList = [...new Set([
    ...(lud16Tags.length > 0 ? lud16Tags : []),
    ...(lud06Tags.length > 0 ? lud06Tags : []),
    ...wLightningAddresses,
    ...(profileObj.lud16 ? [profileObj.lud16] : []),
    ...(profileObj.lud06 ? [profileObj.lud06] : []),
    ...(lightningAddressFromJson && !lightningAddressFromTags ? [lightningAddressFromJson] : [])
  ])].filter(Boolean)
  
  const username =
    profileObj.display_name?.trim() ||
    profileObj.name?.trim() ||
    nip05?.split('@')[0]?.trim()
  
  // Resolve picture URL (prefer tag over JSON)
  const pictureTags = event.tags.filter(tag => tag[0] === 'picture' && tag[1]).map(tag => tag[1])
  const avatarUrl = pictureTags.length > 0 ? pictureTags[0] : profileObj.picture

  // Look up file size from any matching imeta tag in the kind-0 event
  let pictureSize: number | undefined
  if (avatarUrl) {
    for (const tag of event.tags) {
      const info = getImetaInfoFromImetaTag(tag)
      if (info && info.url === avatarUrl && info.size != null) {
        pictureSize = info.size
        break
      }
    }
  }

  return {
    pubkey: event.pubkey,
    npub: pubkeyToNpub(event.pubkey) ?? '',
    banner: profileObj.banner,
    avatar: avatarUrl,
    pictureSize,
    isBot: event.kind === 0 ? profileIsBotFromKind0Tags(event.tags as string[][]) : undefined,
    username: username || formatPubkey(event.pubkey),
    original_username: username,
    nip05,
    nip05List: nip05List && nip05List.length > 0 ? nip05List : undefined,
    about: profileObj.about,
    website,
    websiteList: websiteList && websiteList.length > 0 ? websiteList : undefined,
    lud06,
    lud16,
    lightningAddress,
    lightningAddressList: lightningAddressList.length > 0 ? lightningAddressList : undefined,
    wWalletTags: wWalletTags.length > 0 ? wWalletTags : undefined,
    created_at: event.created_at
  }
}

const paymentInfoByEventId = new Map<string, TPaymentInfo | null>()

export function getPaymentInfoFromEvent(event: Event): TPaymentInfo | null {
  if (event.kind !== 10133) return null

  if (paymentInfoByEventId.has(event.id)) {
    return paymentInfoByEventId.get(event.id) ?? null
  }
  
  // Parse JSON content as fallback
  let paymentInfo: any = {}
  try {
    if (event.content) {
      paymentInfo = JSON.parse(event.content)
    }
  } catch (err) {
    logger.error('Failed to parse payment info JSON', { error: err, content: event.content })
  }

  // Extract payment methods from tags (preferred over JSON content)
  // NIP-A3 format: ["payto", "<type>", "<authority>", "<optional_extra_1>", ...]
  // tag[0] = "payto", tag[1] = type, tag[2] = authority
  const paytoTags = event.tags.filter(tag => tag[0] === 'payto' && tag[1] && tag[2])
  
  // Build methods array from tags
  const methods: TPaymentInfo['methods'] = []
  
  // Parse each payto tag according to NIP-A3 spec
  paytoTags.forEach((tag) => {
    const type = getCanonicalPaytoType(tag[1]?.toLowerCase() || 'lightning')
    const authority = tag[2] || ''
    const extra = tag.slice(3) // Optional extra fields
    
    const paytoUri = buildPaytoUri(type, authority)
    
    const method: any = {
      type,
      authority,
      payto: paytoUri,
      displayType: getPaytoEditorTypeLabel(type),
      ...(extra.length > 0 && { extra })
    }
    methods.push(method)
  })
  
  // If we have methods in JSON but no tags, use JSON methods
  if (methods.length === 0 && paymentInfo.methods && Array.isArray(paymentInfo.methods)) {
    methods.push(
      ...paymentInfo.methods.map((m: any) => {
        const type = getCanonicalPaytoType((m.type || 'lightning').toLowerCase())
        const authority = m.authority || m.address || ''
        return {
          ...m,
          type,
          authority,
          displayType: m.displayType || getPaytoEditorTypeLabel(type),
          payto: m.payto || (type && authority ? `payto://${type}/${authority}` : undefined)
        }
      })
    )
  }
  
  // If we have payto at root level in JSON but no methods array
  if (methods.length === 0 && paymentInfo.payto) {
    methods.push({
      payto: paymentInfo.payto,
      type: paymentInfo.type || 'lightning',
      authority: paymentInfo.authority,
      displayType: getPaytoEditorTypeLabel(paymentInfo.type || 'lightning')
    })
  }
  
  // Build result
  const result: TPaymentInfo = {
    ...paymentInfo,
    methods: methods.length > 0 ? methods : undefined
  }
  
  logger.debug('Parsed payment info', { 
    hasMethods: !!result.methods, 
    methodsCount: result.methods?.length || 0,
    paytoTagsCount: paytoTags.length,
    content: event.content?.substring(0, 200)
  })
  
  paymentInfoByEventId.set(event.id, result)
  return result
}

export function getRelaySetFromEvent(event: Event, blockedRelays?: string[]): TRelaySet {
  const id = getReplaceableEventIdentifier(event)
  
  const relayUrls = event.tags
    .filter(tagNameEquals('relay'))
    .map((tag) => tag[1])
    .filter((url) => url && isWebsocketUrl(url))
    .map((url) => normalizeUrl(url))
    .filter((url): url is string => !!url && !isRelayBlockedByUser(url, blockedRelays))

  let name = event.tags.find(tagNameEquals('title'))?.[1]
  if (!name) {
    name = id
  }

  return { id, name, relayUrls, aTag: buildATag(event) }
}

export function getZapInfoFromEvent(receiptEvent: Event) {
  if (
    receiptEvent.kind !== kinds.Zap &&
    receiptEvent.kind !== ExtendedKind.ZAP_RECEIPT &&
    receiptEvent.kind !== ExtendedKind.ZAP_REQUEST
  ) {
    return null
  }

  // Kind 9734 — zap request: all data is directly on the event (no bolt11, no description wrapper).
  if (receiptEvent.kind === ExtendedKind.ZAP_REQUEST) {
    const senderPubkey = receiptEvent.pubkey
    let recipientPubkey: string | undefined
    let originalEventId: string | undefined
    let eventId: string | undefined
    let amount: number | undefined
    const comment = receiptEvent.content || undefined
    try {
      receiptEvent.tags.forEach((tag) => {
        const [tagName, tagValue] = tag
        switch (tagName) {
          case 'p':
            recipientPubkey = tagValue
            break
          case 'e':
          case 'E':
            originalEventId = tag[1]
            eventId = generateBech32IdFromETag(tag)
            break
          case 'a':
            originalEventId = tag[1]
            eventId = generateBech32IdFromATag(tag)
            break
          case 'amount':
            if (tagValue) amount = Math.floor(parseInt(tagValue, 10) / 1000)
            break
        }
      })
      if (!recipientPubkey || !amount) return null
      return { senderPubkey, recipientPubkey, eventId, originalEventId, invoice: undefined, amount, comment, preimage: undefined }
    } catch {
      return null
    }
  }

  let senderPubkey: string | undefined
  let recipientPubkey: string | undefined
  let originalEventId: string | undefined
  let eventId: string | undefined
  let invoice: string | undefined
  let amount: number | undefined
  let comment: string | undefined
  let description: string | undefined
  let preimage: string | undefined
  try {
    receiptEvent.tags.forEach((tag) => {
      const [tagName, tagValue] = tag
      switch (tagName) {
        case 'P':
          senderPubkey = tagValue
          break
        case 'p':
          recipientPubkey = tagValue
          break
        case 'e':
        case 'E':
          originalEventId = tag[1]
          eventId = generateBech32IdFromETag(tag)
          break
        case 'a':
          originalEventId = tag[1]
          eventId = generateBech32IdFromATag(tag)
          break
        case 'bolt11':
          invoice = tagValue
          break
        case 'description':
          description = tagValue
          break
        case 'preimage':
          preimage = tagValue
          break
      }
    })
    if (!recipientPubkey || !invoice) return null
    
    // Try to parse amount from invoice, fallback to description if invoice is invalid
    try {
      amount = getAmountFromInvoice(invoice)
    } catch {
      amount = 0
    }
    
    if (description) {
      try {
        const zapRequest = JSON.parse(description)
        comment = zapRequest.content
        if (!senderPubkey) {
          senderPubkey = zapRequest.pubkey
        }
        // Extract recipient from zap request
        // Priority: e tag (event) -> a tag (addressable event) -> p tag (profile)
        if (zapRequest.tags) {
          const eTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'e')
          const aTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'a')
          const pTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'p')
          
          if (eTag && eTag[1]) {
            // Event zap - recipient is the author of the zapped event
            // We'll need to fetch this event to get the author's pubkey
            // For now, fall back to p tag
            if (pTag && pTag[1]) {
              recipientPubkey = pTag[1]
            }
          } else if (aTag && aTag[1]) {
            // Addressable event zap - recipient is the author of the zapped event
            // We'll need to fetch this event to get the author's pubkey
            // For now, fall back to p tag
            if (pTag && pTag[1]) {
              recipientPubkey = pTag[1]
            }
          } else if (pTag && pTag[1]) {
            // Profile zap - recipient is directly specified
            recipientPubkey = pTag[1]
          }
        }
        // If invoice parsing failed, try to get amount from zap request tags
        if (amount === 0 && zapRequest.tags) {
          const amountTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'amount')
          if (amountTag && amountTag[1]) {
            const millisats = parseInt(amountTag[1])
            amount = millisats / 1000 // Convert millisats to sats
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      senderPubkey,
      recipientPubkey,
      eventId,
      originalEventId,
      invoice,
      amount,
      comment,
      preimage
    }
  } catch {
    return null
  }
}

// Helper function to convert d-tag / index slug to title case
export function dTagToTitleCase(dTag: string): string {
  return dTag
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Humanize a Mercury index slug (`T` / `N` / `d`) for UI when display tags are absent.
 * Scripts emit single-letter index tags for NIP-01; multi-letter `title`/`author` may be omitted.
 */
export function indexSlugToDisplayLabel(slug: string): string {
  return dTagToTitleCase(slug.trim())
}

export function getLongFormArticleMetadataFromEvent(event: Event) {
  let title: string | undefined
  let titleFromT: string | undefined
  let summary: string | undefined
  let image: string | undefined
  const tags = new Set<string>()

  // Tag names are case-sensitive for single-letter Mercury indexes: `T`≠`t`, `N`≠`n`.
  event.tags.forEach(([tagName, tagValue]) => {
    const raw = (tagName || '').trim()
    const n = raw.toLowerCase()
    const value = tagValue?.trim()
    if (!value) return
    if (raw === 'T') {
      if (!titleFromT) titleFromT = value
      return
    }
    if (n === 'title') {
      title = value
    } else if (n === 'summary') {
      summary = value
    } else if (n === 'image') {
      image = value
    } else if (raw === 't' && tags.size < 6) {
      tags.add(value.replace(/^#/, '').toLowerCase())
    }
  })

  if (!title) {
    if (titleFromT) {
      title = indexSlugToDisplayLabel(titleFromT)
    } else {
      const dTag = event.tags.find(tagNameEquals('d'))?.[1]
      if (dTag) {
        title = dTagToTitleCase(dTag)
      }
    }
  }

  return { title, summary, image, tags: Array.from(tags) }
}

export type PublicationAuthor = {
  name: string
  role?: string
}

export type PublicationIdentifier = {
  /** Raw `i` tag value, e.g. `isbn:0879801220` or `openlibrary:OL45883W`. */
  value: string
  scheme: 'openlibrary' | 'isbn' | 'wikidata' | 'overdrive' | 'wikipedia' | 'gutenberg' | 'other'
  /** Scheme-specific id (without prefix). */
  id: string
  label: string
  url?: string
}

export type PublicationSectionRef = {
  coordinate: string
  label?: string
}

export type PublicationIndexMetadata = {
  title?: string
  summary?: string
  image?: string
  tags: string[]
  authors: PublicationAuthor[]
  source?: string
  type?: string
  version?: string
  releaseDate?: string
  language?: string
  identifiers: PublicationIdentifier[]
  sectionCount: number
  sections: PublicationSectionRef[]
}

/** Resolve a NIP-73 / Open Library style `i` tag value to an external URL. */
export function resolveExternalIdentifierUrl(value: string): string | undefined {
  const trimmed = value.trim()
  const colon = trimmed.indexOf(':')
  if (colon <= 0) return undefined
  const scheme = trimmed.slice(0, colon).toLowerCase()
  const id = trimmed.slice(colon + 1).trim()
  if (!id) return undefined

  switch (scheme) {
    case 'openlibrary':
      return id.startsWith('OL')
        ? `https://openlibrary.org/works/${id}`
        : `https://openlibrary.org/${id}`
    case 'isbn':
      return `https://openlibrary.org/isbn/${id.replace(/[^0-9Xx]/g, '')}`
    case 'wikidata':
      return `https://www.wikidata.org/wiki/${id}`
    case 'overdrive':
      return `https://share.libbyapp.com/title/${encodeURIComponent(id)}`
    case 'gutenberg': {
      const ebookId = id.replace(/[^\d]/g, '')
      return ebookId ? `https://www.gutenberg.org/ebooks/${ebookId}` : undefined
    }
    case 'wikipedia': {
      // wikipedia:en:Aardvark or wikipedia:en:Albert_Einstein
      const m = /^([a-z]{2,3}):(.+)$/i.exec(id)
      if (!m) return undefined
      const lang = m[1].toLowerCase()
      const page = m[2].trim().replace(/ /g, '_')
      if (!page) return undefined
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%2F/gi, '/')}`
    }
    default:
      return undefined
  }
}

function parsePublicationIdentifier(raw: string): PublicationIdentifier | null {
  const value = raw.trim()
  if (!value) return null

  // Publishers sometimes put the page URL itself in `i` (or expanders do). Treat as a link,
  // not as scheme `https` with the full URL as the chip label.
  if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`
    let label = href
    try {
      label = new URL(href).hostname.replace(/^www\./, '')
    } catch {
      // keep href
    }
    return {
      value,
      scheme: 'other',
      id: value,
      label,
      url: href
    }
  }

  const colon = value.indexOf(':')
  const schemeRaw = colon > 0 ? value.slice(0, colon).toLowerCase() : 'other'
  const id = colon > 0 ? value.slice(colon + 1).trim() : value
  if (!id) return null

  const scheme =
    schemeRaw === 'openlibrary' ||
    schemeRaw === 'isbn' ||
    schemeRaw === 'wikidata' ||
    schemeRaw === 'overdrive' ||
    schemeRaw === 'wikipedia' ||
    schemeRaw === 'gutenberg'
      ? schemeRaw
      : 'other'

  const label =
    scheme === 'openlibrary'
      ? 'Open Library'
      : scheme === 'isbn'
        ? `ISBN ${id}`
        : scheme === 'wikidata'
          ? 'Wikidata'
          : scheme === 'overdrive'
            ? 'Borrow in Libby'
            : scheme === 'wikipedia'
              ? (() => {
                  const m = /^([a-z]{2,3}):(.+)$/i.exec(id)
                  if (!m) return value
                  const page = m[2].replace(/_/g, ' ')
                  return `Wikipedia (${m[1].toLowerCase()}): ${page}`
                })()
              : scheme === 'gutenberg'
                ? `Gutenberg #${id.replace(/[^\d]/g, '')}`
                : value

  return {
    value,
    scheme,
    id,
    label,
    url: resolveExternalIdentifierUrl(value)
  }
}

/** NKBIP-01 kind 30040 index metadata from tags (content is always empty). */
export function getPublicationIndexMetadataFromEvent(event: Event): PublicationIndexMetadata {
  const base = getLongFormArticleMetadataFromEvent(event)
  const authors: PublicationAuthor[] = []
  const authorsFromN: PublicationAuthor[] = []
  const identifiers: PublicationIdentifier[] = []
  let sourceS: string | undefined
  let sourceLegacy: string | undefined
  let type: string | undefined
  let version: string | undefined
  let releaseDate: string | undefined
  let language: string | undefined
  const aTagLabels = new Map<string, string>()

  for (const tag of event.tags) {
    // Preserve case for single-letter Mercury tags (`T`/`N`/`s`/`i`/`l`/`t`).
    const raw = (tag[0] || '').trim()
    const name = raw.toLowerCase()
    const value = tag[1]?.trim()
    if (!value) continue

    if (raw === 'N') {
      authorsFromN.push({ name: indexSlugToDisplayLabel(value) })
      continue
    }
    if (name === 'author') {
      const role = tag[2]?.trim()
      authors.push({ name: value, role: role || undefined })
    } else if (raw === 's' || name === 's') {
      if (!sourceS) sourceS = value
    } else if (name === 'source') {
      if (!sourceLegacy) sourceLegacy = value
    } else if (name === 'type') {
      type = value
    } else if (name === 'version') {
      version = value
    } else if (name === 'release_date' || name === 'published_on') {
      if (!releaseDate) releaseDate = value
    } else if (raw === 'i' || name === 'i') {
      const hint = tag[2]?.trim()
      const parsed = parsePublicationIdentifier(value)
      if (parsed) {
        if (hint && /^https?:\/\//i.test(hint)) {
          parsed.url = hint
        }
        identifiers.push(parsed)
      }
    } else if ((raw === 'l' || name === 'l') && !language) {
      language = value
    } else if (raw === 'a' || name === 'a') {
      const label = tag[3]?.trim()
      if (
        label &&
        !label.startsWith('wss://') &&
        !label.startsWith('ws://') &&
        !/^[0-9a-f]{64}$/i.test(label)
      ) {
        aTagLabels.set(value, label)
      }
    }
  }

  const resolvedAuthors = authors.length > 0 ? authors : authorsFromN

  const sections: PublicationSectionRef[] = orderedPublicationRefsFromIndex(event).map((ref) => {
    if (ref.type === 'a' && ref.coordinate) {
      return { coordinate: ref.coordinate, label: aTagLabels.get(ref.coordinate) }
    }
    if (ref.type === 'e' && ref.eventId) {
      return { coordinate: ref.eventId }
    }
    return { coordinate: ref.coordinate ?? ref.eventId ?? '' }
  }).filter((section) => section.coordinate)

  const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]?.trim()
  const gutenbergIdFromDTag = dTag ? parseGutenbergEbookIdFromDTag(dTag) : null
  let source = sourceS || sourceLegacy
  if (!source && gutenbergIdFromDTag) {
    source = gutenbergEbookPageUrl(gutenbergIdFromDTag)
  }

  let image = base.image?.trim() || undefined
  if (image) {
    image = normalizeGutenbergCoverImageUrl(image)
  } else {
    image =
      resolveGutenbergCoverImageUrl(source) ??
      (gutenbergIdFromDTag ? gutenbergCoverImageUrl(gutenbergIdFromDTag) : undefined)
  }

  return {
    ...base,
    image,
    authors: resolvedAuthors,
    source,
    type,
    version,
    releaseDate,
    language,
    identifiers,
    sectionCount: sections.length,
    sections
  }
}

/**
 * Source URL (`s`, else `source`) plus `i` identifier chips for wiki / publication chrome.
 * Returns one deduped list: source first, then identifiers whose URLs are not the same page.
 */
export type ContentProvenanceLink = {
  href: string
  label: string
}

/**
 * Canonical key for provenance dedupe: scheme/host/path only.
 * Collapses http↔https, www, default ports, trailing slashes, hash, and query.
 */
export function normalizeProvenanceUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^\/\//.test(trimmed)
        ? `https:${trimmed}`
        : `https://${trimmed}`
    const u = new URL(withScheme)
    // Ignore scheme differences (http vs https) and fragments / tracking queries.
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    let path = u.pathname
    try {
      path = decodeURIComponent(path)
    } catch {
      // keep encoded
    }
    // Wiki titles use `_` in URLs and spaces in some tags — treat as the same page.
    path = path.replace(/ /g, '_')
    path = path.replace(/\/+$/, '') || '/'
    return `https://${host}${path}`.toLowerCase()
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '')
  }
}

function provenanceHostnameLabel(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, '')
  } catch {
    return source
  }
}

export function getContentProvenanceFromEvent(event: Event): ContentProvenanceLink[] {
  const meta = getPublicationIndexMetadataFromEvent(event)
  const links: ContentProvenanceLink[] = []
  const seen = new Set<string>()

  const push = (href: string, label: string) => {
    const key = normalizeProvenanceUrl(href)
    if (!href.trim() || seen.has(key)) return
    seen.add(key)
    links.push({ href, label })
  }

  if (meta.source) {
    push(meta.source, provenanceHostnameLabel(meta.source))
  }

  const identifiers = [...meta.identifiers]
  if (identifiers.length === 0 && meta.source) {
    const derived = expandIdentifier(meta.source)
    for (const raw of derived.i ?? []) {
      const parsed = parsePublicationIdentifier(raw)
      if (parsed) identifiers.push(parsed)
    }
  }

  for (const identifier of identifiers) {
    const href = identifier.url?.trim()
    if (href) {
      push(href, identifier.label || provenanceHostnameLabel(href))
      continue
    }
    if (!identifier.label) continue
    // URL-shaped labels without a resolved href still collide with source / other links.
    if (/^https?:\/\//i.test(identifier.label) || /^www\./i.test(identifier.label)) {
      const asHref = /^https?:\/\//i.test(identifier.label)
        ? identifier.label
        : `https://${identifier.label}`
      push(asHref, provenanceHostnameLabel(asHref))
      continue
    }
    const key = `label:${identifier.label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ href: '', label: identifier.label })
  }

  return links
}

export function getLiveEventMetadataFromEvent(event: Event) {
  let title: string | undefined
  let room: string | undefined
  let summary: string | undefined
  let image: string | undefined
  let thumb: string | undefined
  let status: string | undefined
  const tags = new Set<string>()

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'title' && tagValue?.trim()) {
      title = tagValue.trim()
    } else if (tagName === 'room' && tagValue?.trim()) {
      room = tagValue.trim()
    } else if (tagName === 'summary' && tagValue?.trim()) {
      summary = tagValue.trim()
    } else if (tagName === 'image' && tagValue?.trim()) {
      image = tagValue.trim()
    } else if (tagName === 'thumb' && tagValue?.trim()) {
      thumb = tagValue.trim()
    } else if (tagName === 'status' && tagValue?.trim()) {
      status = tagValue.trim().toLowerCase()
    } else if (tagName === 't' && tagValue?.trim() && tags.size < 6) {
      tags.add(tagValue.trim().toLowerCase())
    }
  })

  const dTag = event.tags.find(tagNameEquals('d'))?.[1]
  const dTitle = dTag ? dTagToTitleCase(dTag) : undefined
  /** NIP-53 meeting space (30312) uses `room`; live ticker / meeting (30311/30313) use `title` first. */
  if (event.kind === 30312) {
    title = room || title || dTitle || 'no title'
  } else {
    title = title || room || dTitle || 'no title'
  }

  return { title, summary, image, thumb, status, tags: Array.from(tags) }
}

export function getGroupMetadataFromEvent(event: Event) {
  let d: string | undefined
  let name: string | undefined
  let about: string | undefined
  let picture: string | undefined
  const tags = new Set<string>()

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'name') {
      name = tagValue
    } else if (tagName === 'about') {
      about = tagValue
    } else if (tagName === 'picture') {
      picture = tagValue
    } else if (tagName === 't' && tagValue) {
      tags.add(tagValue.toLowerCase())
    } else if (tagName === 'd') {
      d = tagValue
    }
  })

  if (!name) {
    name = d ?? 'no name'
  }

  return { d, name, about, picture, tags: Array.from(tags) }
}

export function getCommunityDefinitionFromEvent(event: Event) {
  let name: string | undefined
  let description: string | undefined
  let image: string | undefined

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'name') {
      name = tagValue
    } else if (tagName === 'description') {
      description = tagValue
    } else if (tagName === 'image') {
      image = tagValue
    }
  })

  if (!name) {
    name = event.tags.find(tagNameEquals('d'))?.[1] ?? 'no name'
  }

  return { name, description, image }
}

export function getPollMetadataFromEvent(event: Event) {
  const options: { id: string; label: string }[] = []
  const relayUrls: string[] = []
  let pollType: TPollType = POLL_TYPE.SINGLE_CHOICE
  let endsAt: number | undefined

  for (const [tagName, ...tagValues] of event.tags) {
    if (tagName === 'option' && tagValues.length >= 2) {
      const [optionId, label] = tagValues
      if (optionId && label) {
        options.push({ id: optionId, label })
      }
    } else if (tagName === 'relay' && tagValues[0]) {
      const normalizedUrl = normalizeUrl(tagValues[0])
      if (normalizedUrl) relayUrls.push(tagValues[0])
    } else if (tagName === 'polltype' && tagValues[0]) {
      if (tagValues[0] === POLL_TYPE.MULTIPLE_CHOICE) {
        pollType = POLL_TYPE.MULTIPLE_CHOICE
      }
    } else if (tagName === 'endsAt' && tagValues[0]) {
      const timestamp = parseInt(tagValues[0])
      if (!isNaN(timestamp)) {
        endsAt = timestamp
      }
    }
  }

  if (options.length === 0) {
    return null
  }

  return {
    options,
    pollType,
    relayUrls,
    endsAt
  }
}

export function getPollResponseFromEvent(
  event: Event,
  optionIds: string[],
  isMultipleChoice: boolean
) {
  const selectedOptionIds: string[] = []

  for (const [tagName, ...tagValues] of event.tags) {
    if (tagName === 'response' && tagValues[0]) {
      if (optionIds && !optionIds.includes(tagValues[0])) {
        continue // Skip if the response is not in the provided optionIds
      }
      selectedOptionIds.push(tagValues[0])
    }
  }

  // If no valid responses are found, return null
  if (selectedOptionIds.length === 0) {
    return null
  }

  // If multiple responses are selected but the poll is not multiple choice, return null
  if (selectedOptionIds.length > 1 && !isMultipleChoice) {
    return null
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    selectedOptionIds,
    created_at: event.created_at
  }
}

export function getEmojisAndEmojiSetsFromEvent(event: Event) {
  const emojis: TEmoji[] = []
  const emojiSetPointers: string[] = []

  event.tags.forEach(([tagName, ...tagValues]) => {
    if (tagName === 'emoji' && tagValues.length >= 2) {
      emojis.push({
        shortcode: tagValues[0],
        url: tagValues[1]
      })
    } else if (tagName === 'a' && tagValues[0]) {
      const coord = tagValues[0]
      const kindStr = coord.split(':')[0]
      const kind = parseInt(kindStr ?? '', 10)
      if (kind === kinds.Emojisets) {
        emojiSetPointers.push(tagValues[0])
      }
    }
  })

  return { emojis, emojiSetPointers }
}

export function getEmojisFromEvent(event: Event): TEmoji[] {
  const emojis: TEmoji[] = []

  event.tags.forEach(([tagName, ...tagValues]) => {
    if (tagName === 'emoji' && tagValues.length >= 2) {
      emojis.push({
        shortcode: tagValues[0],
        url: tagValues[1]
      })
    }
  })

  return emojis
}

export function getStarsFromRelayReviewEvent(event: Event): number {
  const ratingTag = event.tags.find((t) => t[0] === 'rating')
  if (!ratingTag?.[1]?.trim()) return 0
  const raw = parseFloat(ratingTag[1])
  if (Number.isNaN(raw) || raw <= 0) return 0
  // This app publishes `rating` as stars/5 (e.g. 5★ → "1"); scale back to 1–5.
  if (raw <= 1) {
    const scaled = raw * 5
    if (scaled > 0 && scaled <= 5) return scaled
    return 0
  }
  // Many clients use a plain 1–5 value in the tag.
  if (raw >= 1 && raw <= 5) return raw
  return 0
}

/** Relay URL from the `d` tag (NIP for relay reviews). */
export function getRelayUrlFromRelayReviewEvent(event: Event): string | undefined {
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (!d) return undefined
  return normalizeAnyRelayUrl(d) || d
}
