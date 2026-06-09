import { LRUCache } from 'lru-cache'
import { nip19 } from 'nostr-tools'
import {
  clearSitesProxyUnavailableThisSession,
  isSitesProxyUnavailableThisSession,
  markSitesProxyUnavailableFromHttpStatus
} from '@/lib/optional-proxy-session'
import { buildDevLocalSitesFetchUrl, buildViteProxySitesFetchUrl } from '@/lib/vite-proxy-url'
import { hexPubkeysEqual, isValidPubkey, normalizeHexPubkey, userIdToPubkey } from './pubkey'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'

type TVerifyNip05Result = {
  isVerified: boolean
  nip05Name: string
  nip05Domain: string
  relays?: string[]
}

/** Bumps when verification rules change so LRU does not serve stale false negatives. */
const VERIFY_CACHE_SCHEMA = 9

/** Bumps when well-known fetch/parse rules change so stale empty cache entries are not reused. */
const WELL_KNOWN_CACHE_SCHEMA = 5

type WellKnownCacheEntry = { json: Record<string, unknown> | null; schema: number }

/** Per-domain `nostr.json` (or negative `null`) so feeds do not re-fetch every NIP-05 on the same host. */
const wellKnownJsonByDomain = new LRUCache<string, WellKnownCacheEntry>({ max: 512 })
const wellKnownDomainInFlight = new Map<string, Promise<Record<string, unknown> | null>>()

function normalizeNip05Domain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function asNip05LookupString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    for (const x of value) {
      if (typeof x === 'string' && x.trim()) return x
    }
    return ''
  }
  return String(value)
}

/**
 * Split `local@domain` on the **first** `@` only (NIP-05 local part must not contain `@`).
 * `split('@')` breaks for domains like `user@sub.example.com` → wrong domain.
 */
export function splitNip05Identifier(nip05Str: string): { name: string; domain: string } | null {
  const s = nip05Str.trim()
  const at = s.indexOf('@')
  if (at <= 0 || at >= s.length - 1) return null
  const name = s.slice(0, at).trim()
  const domain = s.slice(at + 1).trim().replace(/\.$/, '')
  if (!name || !domain) return null
  return { name, domain: domain.toLowerCase() }
}

/** Normalize a `names` entry: hex (any case) or `npub1…` → lowercase hex, else null. */
function pubkeyHexFromWellKnownNamesValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let t = v.trim()
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2).trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  if (t.startsWith('npub1')) {
    try {
      const { type, data } = nip19.decode(t)
      if (type === 'npub' && typeof data === 'string' && isValidPubkey(data)) return data.toLowerCase()
    } catch {
      return null
    }
  }
  return null
}

function npubFromHexPubkey(hex: string): string | null {
  try {
    return nip19.npubEncode(normalizeHexPubkey(hex))
  } catch {
    return null
  }
}

export type TNip05NamePubkeyEntry = { name: string; pubkey: string }

/**
 * Parse one `names` row. Supports:
 * - standard: `username` → hex or npub
 * - inverted: hex or npub key → `username` label
 */
export function parseNip05NamePubkeyEntry(key: string, value: unknown): TNip05NamePubkeyEntry | null {
  const hexFromValue = pubkeyHexFromWellKnownNamesValue(value)
  if (hexFromValue) {
    return { name: key, pubkey: hexFromValue }
  }
  const hexFromKey = pubkeyHexFromWellKnownNamesValue(key)
  if (!hexFromKey) return null
  const label = asNip05LookupString(value).trim()
  if (!label || pubkeyHexFromWellKnownNamesValue(label)) return null
  return { name: label, pubkey: hexFromKey }
}

function resolveNamesEntry(
  names: Record<string, unknown>,
  nip05Name: string,
  userPubkeyHex?: string
): TNip05NamePubkeyEntry | null {
  const want = nip05Name.trim()
  if (!want) return null

  const direct = getNamesEntryRaw(names, want)
  if (direct != null) {
    const hex = pubkeyHexFromWellKnownNamesValue(direct)
    if (hex) return { name: want, pubkey: hex }
  }

  for (const [key, v] of Object.entries(names)) {
    const entry = parseNip05NamePubkeyEntry(key, v)
    if (entry && entry.name.toLowerCase() === want.toLowerCase()) return entry
  }

  if (!userPubkeyHex || !isValidPubkey(userPubkeyHex)) return null
  const user = normalizeHexPubkey(userPubkeyHex)
  const userNpub = npubFromHexPubkey(user)
  if (userNpub) {
    for (const [key, v] of Object.entries(names)) {
      if (key.toLowerCase() !== userNpub.toLowerCase()) continue
      const entry = parseNip05NamePubkeyEntry(key, v)
      if (entry && hexPubkeysEqual(entry.pubkey, user)) return entry
      const hex = pubkeyHexFromWellKnownNamesValue(v)
      if (hex && hexPubkeysEqual(hex, user)) return { name: want, pubkey: hex }
    }
  }

  for (const [key, v] of Object.entries(names)) {
    const entry = parseNip05NamePubkeyEntry(key, v)
    if (entry && hexPubkeysEqual(entry.pubkey, user)) return entry
  }

  return null
}

function nip05LocalNameForPubkeyFromNames(
  names: Record<string, unknown> | undefined,
  userPubkeyHex: string
): string | undefined {
  if (!names || typeof names !== 'object') return undefined
  const user = normalizeHexPubkey(userPubkeyHex)
  for (const [key, v] of Object.entries(names)) {
    const entry = parseNip05NamePubkeyEntry(key, v)
    if (entry && hexPubkeysEqual(entry.pubkey, user)) return entry.name
  }
  return undefined
}

function getNamesEntryRaw(names: Record<string, unknown>, nip05Name: string): string | undefined {
  if (!nip05Name || typeof names !== 'object' || names == null) return undefined
  const asTrimmedString = (x: unknown): string | undefined =>
    typeof x === 'string' && x.trim() ? x.trim() : undefined
  const direct = asTrimmedString(names[nip05Name])
  if (direct !== undefined) return direct
  const want = nip05Name.toLowerCase()
  for (const k of Object.keys(names)) {
    if (k.toLowerCase() === want) return asTrimmedString(names[k])
  }
  return undefined
}

function asRelayUrlList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const urls = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    return urls.length > 0 ? urls : []
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const urls = Object.values(value as Record<string, unknown>).filter(
      (x): x is string => typeof x === 'string' && x.trim().length > 0
    )
    return urls.length > 0 ? urls : []
  }
  return undefined
}

function pickRelayListForPubkey(
  relays: Record<string, unknown> | undefined,
  userPubkeyHex: string,
  listedRaw: string,
  nip05LocalName: string,
  names?: Record<string, unknown>
): unknown {
  if (!relays || typeof relays !== 'object') return undefined
  const user = normalizeHexPubkey(userPubkeyHex)
  const keysToTry = new Set<string>()
  keysToTry.add(user)
  keysToTry.add(userPubkeyHex.trim())
  keysToTry.add(listedRaw.trim())
  const userNpub = npubFromHexPubkey(user)
  if (userNpub) keysToTry.add(userNpub)
  const listedHex = pubkeyHexFromWellKnownNamesValue(listedRaw)
  if (listedHex) {
    keysToTry.add(listedHex)
    const listedNpub = npubFromHexPubkey(listedHex)
    if (listedNpub) keysToTry.add(listedNpub)
  }
  for (const k of keysToTry) {
    if (!k) continue
    const urls = asRelayUrlList(relays[k])
    if (urls !== undefined) return urls
  }
  for (const k of Object.keys(relays)) {
    if (pubkeyHexFromWellKnownNamesValue(k) === user) {
      const urls = asRelayUrlList(relays[k])
      if (urls !== undefined) return urls
    }
  }
  const local =
    nip05LocalName.trim() || nip05LocalNameForPubkeyFromNames(names, userPubkeyHex) || ''
  if (local) {
    const want = local.toLowerCase()
    for (const k of Object.keys(relays)) {
      if (k.toLowerCase() === want) {
        const urls = asRelayUrlList(relays[k])
        if (urls !== undefined) return urls
      }
    }
  }
  return undefined
}

/** Only successful verifications are cached — failed fetches must not stick when well-known loads later. */
const verifyNip05ResultCache = new LRUCache<string, TVerifyNip05Result>({ max: 1000 })

function verifyNip05CacheKey(nip05: string, pubkey: string): string {
  return JSON.stringify({ s: VERIFY_CACHE_SCHEMA, nip05, pubkey })
}

export function verifyNip05AgainstWellKnown(
  json: Record<string, unknown> | null,
  nip05Name: string,
  userHex: string,
  base: TVerifyNip05Result
): TVerifyNip05Result {
  if (!json) return base

  const names = json.names as Record<string, unknown> | undefined
  if (!names || typeof names !== 'object') return base

  const resolved = resolveNamesEntry(names, nip05Name, userHex)
  if (!resolved || !hexPubkeysEqual(resolved.pubkey, userHex)) return base

  const relays = json.relays as Record<string, unknown> | undefined
  const relayList = pickRelayListForPubkey(
    relays,
    userHex,
    resolved.pubkey,
    resolved.name,
    names
  )
  return {
    ...base,
    isVerified: true,
    relays: Array.isArray(relayList) ? (relayList as string[]) : undefined
  }
}

async function _verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05).trim()
  const split = splitNip05Identifier(nip05Str)
  const nip05Name = split?.name ?? ''
  const nip05Domain = split?.domain ?? ''
  const result: TVerifyNip05Result = { isVerified: false, nip05Name, nip05Domain }
  const userHex = normalizePubkeyForNip05Lookup(pubkey)
  if (!split || !userHex) return result

  const fullDoc = await getOrFetchWellKnownJsonForDomain(nip05Domain)
  let verified = verifyNip05AgainstWellKnown(fullDoc, nip05Name, userHex, result)
  if (verified.isVerified) return verified

  // NIP-05: dynamic hosts (e.g. nostr.land) only include the user when `?name=` is set.
  // Do not cache these responses — they are not a full domain listing.
  if (nip05Name) {
    const scoped = await fetchWellKnownNostrJsonOnce(nip05Domain, nip05Name)
    verified = verifyNip05AgainstWellKnown(scoped, nip05Name, userHex, result)
  }
  return verified
}

export async function verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05).trim()
  const pubkeyNorm = normalizePubkeyForNip05Lookup(pubkey) ?? pubkey.trim()
  const cacheKey = verifyNip05CacheKey(nip05Str, pubkeyNorm)
  const cached = verifyNip05ResultCache.get(cacheKey)
  if (cached?.isVerified) return cached

  const result = await _verifyNip05(nip05Str, pubkeyNorm)
  if (result.isVerified) {
    verifyNip05ResultCache.set(cacheKey, result)
  }
  return result
}

export function getWellKnownNip05Url(domain: string, name?: string): string {
  const url = new URL('/.well-known/nostr.json', `https://${domain}`)
  if (name) {
    url.searchParams.set('name', name)
  }
  return url.toString()
}

function normalizePubkeyForNip05Lookup(pubkey: string): string | null {
  const hex = userIdToPubkey(pubkey.trim())
  return hex && isValidPubkey(hex) ? normalizeHexPubkey(hex) : null
}

function normalizeWellKnownNamesField(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (!Array.isArray(raw)) return null
  const out: Record<string, unknown> = {}
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      out[String(item[0])] = item[1]
      continue
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>
      if (typeof rec.name === 'string' && rec.pubkey != null) {
        out[rec.name] = rec.pubkey
      } else if (typeof rec.key === 'string' && rec.value != null) {
        out[rec.key] = rec.value
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function normalizeWellKnownDocument(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const doc = data as Record<string, unknown>
  const names = normalizeWellKnownNamesField(doc.names)
  if (!names) return null
  return { ...doc, names }
}

function isWellKnownNostrJsonDocument(data: unknown): data is Record<string, unknown> {
  return normalizeWellKnownDocument(data) != null
}

async function readWellKnownNostrJsonResponse(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json()
    return normalizeWellKnownDocument(data)
  } catch {
    return null
  }
}

async function fetchWellKnownNostrJsonFromUrl(
  fetchUrl: string,
  opts?: { viaProxy?: boolean }
): Promise<Record<string, unknown> | null> {
  try {
    // Direct cross-origin fetches must stay "simple" (no custom Accept) so hosts with broken
    // OPTIONS handlers (e.g. theforest.nostr1.com returns 500 on preflight) still load via GET.
    const res = await fetchWithTimeout(fetchUrl, {
      credentials: 'omit',
      ...(opts?.viaProxy
        ? {
            headers: {
              Accept: 'application/nostr+json, application/json;q=0.9, text/plain;q=0.8, */*;q=0.1'
            }
          }
        : {}),
      timeoutMs: 15_000,
      mode: 'cors'
    })
    const json = await readWellKnownNostrJsonResponse(res)
    if (json) {
      if (opts?.viaProxy && res.ok) clearSitesProxyUnavailableThisSession()
      return json
    }
    if (!res.ok && opts?.viaProxy && !res.redirected) {
      markSitesProxyUnavailableFromHttpStatus(res.status)
    }
    return null
  } catch {
    return null
  }
}

async function fetchWellKnownNostrJsonDirect(targetUrl: string): Promise<Record<string, unknown> | null> {
  return fetchWellKnownNostrJsonFromUrl(targetUrl)
}

/**
 * Fetch `/.well-known/nostr.json` in the browser without tripping third-party CORS:
 * direct first (NIP-05 hosts usually allow *), then dev `/sites` proxy, configured proxy, then public CORS proxies in dev.
 */
async function fetchWellKnownNostrJsonOnce(
  domain: string,
  nameInQuery: string | undefined
): Promise<Record<string, unknown> | null> {
  const targetUrl = getWellKnownNip05Url(domain, nameInQuery)

  const direct = await fetchWellKnownNostrJsonDirect(targetUrl)
  if (direct) return direct

  const proxyDown = isSitesProxyUnavailableThisSession()
  const proxyServer = import.meta.env.VITE_PROXY_SERVER?.trim()
  if (proxyServer && !proxyDown) {
    const viaProxy = await fetchWellKnownNostrJsonFromUrl(
      buildViteProxySitesFetchUrl(targetUrl, proxyServer),
      { viaProxy: true }
    )
    if (viaProxy) return viaProxy
  }

  if (import.meta.env.DEV) {
    const devSitesUrl = buildDevLocalSitesFetchUrl(targetUrl)
    if (devSitesUrl && !proxyDown) {
      const viaDev = await fetchWellKnownNostrJsonFromUrl(devSitesUrl, { viaProxy: true })
      if (viaDev) return viaDev
    }

    for (const fetchUrl of [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
    ]) {
      const viaPublic = await fetchWellKnownNostrJsonFromUrl(fetchUrl)
      if (viaPublic) return viaPublic
    }
  }

  return null
}

/** Full domain document for listing/cache (no `?name=` — partial responses must not poison domain cache). */
async function fetchWellKnownFullDocument(domain: string): Promise<Record<string, unknown> | null> {
  return fetchWellKnownNostrJsonOnce(domain, undefined)
}

async function getOrFetchWellKnownJsonForDomain(
  domain: string
): Promise<Record<string, unknown> | null> {
  const key = normalizeNip05Domain(domain)
  if (!key) return null
  if (wellKnownJsonByDomain.has(key)) {
    const cached = wellKnownJsonByDomain.get(key)!
    if (cached.schema === WELL_KNOWN_CACHE_SCHEMA && cached.json && isWellKnownNostrJsonDocument(cached.json)) {
      return cached.json
    }
    wellKnownJsonByDomain.delete(key)
  }
  let inflight = wellKnownDomainInFlight.get(key)
  if (!inflight) {
    inflight = fetchWellKnownFullDocument(key).then((json) => {
      wellKnownDomainInFlight.delete(key)
      if (isWellKnownNostrJsonDocument(json)) {
        wellKnownJsonByDomain.set(key, { json, schema: WELL_KNOWN_CACHE_SCHEMA })
      }
      return json
    })
    wellKnownDomainInFlight.set(key, inflight)
  }
  return inflight
}

/** Fetch full `/.well-known/nostr.json` for a domain (domain listing / relay discovery). */
async function fetchWellKnownNostrJson(domain: string): Promise<Record<string, unknown> | null> {
  return getOrFetchWellKnownJsonForDomain(domain)
}

export async function fetchPubkeysFromDomain(domain: string): Promise<string[]> {
  const entries = await fetchNip05NamePubkeysFromDomain(domain)
  return entries.map((e) => e.pubkey)
}

/** Prefer human NIP-05 local parts over `_`, hex keys, or npub labels when one pubkey appears twice. */
function nip05DomainListNameScore(name: string): number {
  if (name === '_') return 0
  if (/^[0-9a-f]{64}$/i.test(name) || name.startsWith('npub1')) return 1
  return 2
}

export function parseNip05NamePubkeysFromWellKnownJson(
  json: Record<string, unknown>
): Array<{ name: string; pubkey: string }> {
  const normalized = normalizeWellKnownDocument(json)
  if (!normalized) return []
  const names = normalized.names as Record<string, unknown>
  const byPubkey = new Map<string, { name: string; pubkey: string }>()
  for (const [key, v] of Object.entries(names)) {
    const entry = parseNip05NamePubkeyEntry(key, v)
    if (!entry || !isValidPubkey(entry.pubkey)) continue
    const pk = entry.pubkey.toLowerCase()
    const prev = byPubkey.get(pk)
    if (
      !prev ||
      nip05DomainListNameScore(entry.name) > nip05DomainListNameScore(prev.name)
    ) {
      byPubkey.set(pk, { name: entry.name, pubkey: pk })
    }
  }
  const out = [...byPubkey.values()]
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function fetchNip05NamePubkeysFromDomain(
  domain: string
): Promise<Array<{ name: string; pubkey: string }>> {
  try {
    const json = await fetchWellKnownNostrJson(domain)
    if (!json) return []
    return parseNip05NamePubkeysFromWellKnownJson(json)
  } catch (error) {
    logger.error('Error fetching pubkeys from domain', { error, domain })
    return []
  }
}

/**
 * Attempt to get relays from NIP-07 extension
 * Some extensions support a getRelays() method
 */
export async function getRelaysFromNip07Extension(): Promise<string[]> {
  try {
    if (window.nostr && typeof window.nostr.getRelays === 'function') {
      const relaysObj = await window.nostr.getRelays()
      // getRelays() returns an object like { "wss://relay.url": {read: true, write: true} }
      return Object.keys(relaysObj || {})
    }
  } catch (error) {
    logger.warn('NIP-07 extension does not support getRelays()', error as Error)
  }
  return []
}
