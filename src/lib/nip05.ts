import { LRUCache } from 'lru-cache'
import { nip19 } from 'nostr-tools'
import {
  clearSitesProxyUnavailableThisSession,
  isSitesProxyUnavailableThisSession,
  markSitesProxyUnavailableFromHttpStatus
} from '@/lib/optional-proxy-session'
import { buildViteProxySitesFetchUrl } from '@/lib/vite-proxy-url'
import { hexPubkeysEqual, isValidPubkey, normalizeHexPubkey } from './pubkey'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'

type TVerifyNip05Result = {
  isVerified: boolean
  nip05Name: string
  nip05Domain: string
  relays?: string[]
}

/** Bumps when verification rules change so LRU does not serve stale false negatives. */
const VERIFY_CACHE_SCHEMA = 5

/** Bumps when well-known fetch/parse rules change so stale empty cache entries are not reused. */
const WELL_KNOWN_CACHE_SCHEMA = 3

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
    const v = relays[k]
    if (Array.isArray(v)) return v
  }
  for (const k of Object.keys(relays)) {
    if (pubkeyHexFromWellKnownNamesValue(k) === user) {
      const v = relays[k]
      if (Array.isArray(v)) return v
    }
  }
  const local =
    nip05LocalName.trim() || nip05LocalNameForPubkeyFromNames(names, userPubkeyHex) || ''
  if (local) {
    const want = local.toLowerCase()
    for (const k of Object.keys(relays)) {
      if (k.toLowerCase() === want) {
        const v = relays[k]
        if (Array.isArray(v)) return v
      }
    }
  }
  return undefined
}

const verifyNip05ResultCache = new LRUCache<string, TVerifyNip05Result>({
  max: 1000,
  fetchMethod: (key) => {
    const parsed = JSON.parse(key) as { s?: number; nip05?: unknown; pubkey?: unknown }
    const nip05 = asNip05LookupString(parsed.nip05).trim()
    const pubkey = typeof parsed.pubkey === 'string' ? parsed.pubkey.trim() : ''
    return _verifyNip05(nip05, pubkey)
  }
})

async function _verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05).trim()
  const split = splitNip05Identifier(nip05Str)
  const nip05Name = split?.name ?? ''
  const nip05Domain = split?.domain ?? ''
  const result: TVerifyNip05Result = { isVerified: false, nip05Name, nip05Domain }
  if (!split || !pubkey || !isValidPubkey(pubkey)) return result

  const userHex = normalizeHexPubkey(pubkey)
  const json = await fetchWellKnownNostrJson(nip05Domain, nip05Name)
  if (!json) return result

  const names = json.names as Record<string, unknown> | undefined
  if (!names || typeof names !== 'object') return result

  const resolved = resolveNamesEntry(names, nip05Name, userHex)
  if (!resolved || !hexPubkeysEqual(resolved.pubkey, userHex)) return result

  const relays = json.relays as Record<string, unknown> | undefined
  const relayList = pickRelayListForPubkey(
    relays,
    userHex,
    resolved.pubkey,
    resolved.name,
    names
  )
  return { ...result, isVerified: true, relays: Array.isArray(relayList) ? (relayList as string[]) : undefined }
}

export async function verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05).trim()
  const pubkeyStr = typeof pubkey === 'string' ? pubkey.trim() : ''
  const pubkeyNorm = isValidPubkey(pubkeyStr) ? normalizeHexPubkey(pubkeyStr) : pubkeyStr
  const cached = await verifyNip05ResultCache.fetch(
    JSON.stringify({ s: VERIFY_CACHE_SCHEMA, nip05: nip05Str, pubkey: pubkeyNorm })
  )
  if (cached) return cached
  const split = splitNip05Identifier(nip05Str)
  return {
    isVerified: false,
    nip05Name: split?.name ?? '',
    nip05Domain: split?.domain ?? ''
  }
}

export function getWellKnownNip05Url(domain: string, name?: string): string {
  const url = new URL('/.well-known/nostr.json', `https://${domain}`)
  if (name) {
    url.searchParams.set('name', name)
  }
  return url.toString()
}

function isWellKnownNostrJsonDocument(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const names = (data as Record<string, unknown>).names
  return typeof names === 'object' && names != null && !Array.isArray(names)
}

async function readWellKnownNostrJsonResponse(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json()
    return isWellKnownNostrJsonDocument(data) ? data : null
  } catch {
    return null
  }
}

async function fetchWellKnownNostrJsonDirect(targetUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithTimeout(targetUrl, {
      credentials: 'omit',
      headers: {
        Accept: 'application/nostr+json, application/json;q=0.9, text/plain;q=0.8, */*;q=0.1'
      },
      timeoutMs: 15_000,
      mode: 'cors'
    })
    if (!res.ok) return null
    return readWellKnownNostrJsonResponse(res)
  } catch {
    return null
  }
}

async function fetchWellKnownNostrJsonViaProxy(
  targetUrl: string,
  proxyServer: string
): Promise<Record<string, unknown> | null> {
  const fetchUrl = buildViteProxySitesFetchUrl(targetUrl, proxyServer)
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      credentials: 'omit',
      headers: {
        Accept: 'application/nostr+json, application/json;q=0.9, text/plain;q=0.8, */*;q=0.1'
      },
      timeoutMs: 15_000,
      mode: 'cors'
    })
    if (!res.ok) {
      if (!res.redirected) markSitesProxyUnavailableFromHttpStatus(res.status)
      return null
    }
    const json = await readWellKnownNostrJsonResponse(res)
    if (json) clearSitesProxyUnavailableThisSession()
    return json
  } catch {
    return null
  }
}

/**
 * Fetch `/.well-known/nostr.json` in the browser without tripping third-party CORS:
 * when `VITE_PROXY_SERVER` is set (production), use same-origin `/sites/?url=…` like OG preview.
 */
async function fetchWellKnownNostrJsonOnce(
  domain: string,
  nameInQuery: string | undefined
): Promise<Record<string, unknown> | null> {
  const targetUrl = getWellKnownNip05Url(domain, nameInQuery)
  const proxyServer = import.meta.env.VITE_PROXY_SERVER?.trim()
  const useProxy = Boolean(proxyServer && !isSitesProxyUnavailableThisSession())

  if (useProxy) {
    const viaProxy = await fetchWellKnownNostrJsonViaProxy(targetUrl, proxyServer!)
    if (viaProxy) return viaProxy
    return fetchWellKnownNostrJsonDirect(targetUrl)
  }

  return fetchWellKnownNostrJsonDirect(targetUrl)
}

/** Uncached network: optional `?name=` then full document. */
async function fetchWellKnownNostrJsonNetwork(
  domain: string,
  name?: string
): Promise<Record<string, unknown> | null> {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const withQuery =
    trimmedName.length > 0 ? await fetchWellKnownNostrJsonOnce(domain, trimmedName) : null
  if (withQuery && typeof withQuery.names === 'object' && withQuery.names != null) {
    if (resolveNamesEntry(withQuery.names as Record<string, unknown>, trimmedName) != null) {
      return withQuery
    }
  }
  const full = await fetchWellKnownNostrJsonOnce(domain, undefined)
  if (full && trimmedName && typeof full.names === 'object' && full.names != null) {
    if (resolveNamesEntry(full.names as Record<string, unknown>, trimmedName) != null) {
      return full
    }
  }
  return withQuery ?? full
}

async function getOrFetchWellKnownJsonForDomain(
  domain: string,
  nameHint?: string
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
    inflight = fetchWellKnownNostrJsonNetwork(key, nameHint).then((json) => {
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

/** Fetch `/.well-known/nostr.json` (with optional `?name=`). Retries without `name` if the entry is missing. */
async function fetchWellKnownNostrJson(domain: string, name?: string): Promise<Record<string, unknown> | null> {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const hint = trimmedName.length > 0 ? trimmedName : undefined
  return getOrFetchWellKnownJsonForDomain(domain, hint)
}

export async function fetchPubkeysFromDomain(domain: string): Promise<string[]> {
  const entries = await fetchNip05NamePubkeysFromDomain(domain)
  return entries.map((e) => e.pubkey)
}

export function parseNip05NamePubkeysFromWellKnownJson(
  json: Record<string, unknown>
): Array<{ name: string; pubkey: string }> {
  const names = json.names as Record<string, unknown> | undefined
  if (!names || typeof names !== 'object') return []
  const out: Array<{ name: string; pubkey: string }> = []
  const seen = new Set<string>()
  for (const [key, v] of Object.entries(names)) {
    const entry = parseNip05NamePubkeyEntry(key, v)
    if (!entry || !isValidPubkey(entry.pubkey)) continue
    const dedupe = `${entry.name}:${entry.pubkey}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push(entry)
  }
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
