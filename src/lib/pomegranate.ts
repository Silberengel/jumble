import { argon2idAsync } from '@noble/hashes/argon2'
import { bytesToHex } from '@noble/hashes/utils'
import { verifyEvent, type Event } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'

/**
 * Pomegranate (FROST NIP-46 via a central + operators) — web client.
 *
 * Protocol: README.djot at https://git.fiatjaf.com/pomegranate — Google token from
 * `{central}/login/google`, then HTTP account/profiles, then `bunker://` with the
 * central as the NIP-46 relay (no `secret`). Mirrors imwald-android
 * `data/pomegranate/*`; keep both in sync.
 */

export const POMEGRANATE_DEFAULT_COORDINATOR_URL = 'https://auth.njump.me'

/** Kind of the base64 Nostr event central mints as a login token. */
export const POMEGRANATE_KIND_CENTRAL_TOKEN = 20443

/** Kind of setup announcements published by the admin app (signed by the user's key). */
export const POMEGRANATE_KIND_SETUP_ANNOUNCEMENT = 16440

/** Relays where kind-16440 setup announcements live (same list as the admin app / Android). */
export const POMEGRANATE_SETUP_ANNOUNCEMENT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://offchain.pub'
]

const POMEGRANATE_COORDINATOR_STORAGE_KEY = 'pomegranateCoordinatorUrl'

/** Central rejects tokens older than 24h; fail fast with a clearer message. */
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DISCOVERY_TIMEOUT_MS = 8_000

export interface PomegranateGoogleToken {
  raw: string
  email: string
  createdAtMs: number
}

export interface PomegranateAccount {
  email: string | null
  pubkey: string
  threshold: number
}

export interface PomegranateProfile {
  name: string
  handlerPubkey: string
}

export interface PomegranateDiscoveredSetup {
  centralUrl: string
  userPubkey: string
}

export interface PomegranateLoginResult {
  bunkerUrl: string
  centralUrl: string
}

export class PomegranateLoginCancelledError extends Error {
  constructor() {
    super('Pomegranate sign-in cancelled')
  }
}

/** Normalize to origin (scheme + host[+port]), matching the admin/Android `massageOrigin`. */
export function massagePomegranateOrigin(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  let withScheme: string
  if (/^https:\/\//i.test(trimmed)) {
    withScheme = `https://${trimmed.slice(trimmed.indexOf('://') + 3)}`
  } else if (/^http:\/\//i.test(trimmed)) {
    withScheme = `http://${trimmed.slice(trimmed.indexOf('://') + 3)}`
  } else if (/^localhost/i.test(trimmed)) {
    withScheme = `http://${trimmed}`
  } else {
    withScheme = `https://${trimmed}`
  }
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.port ? `${url.protocol}//${url.hostname}:${url.port}` : `${url.protocol}//${url.hostname}`
  } catch {
    return null
  }
}

export function normalizePomegranateCoordinatorBase(raw: string | null | undefined): string {
  return massagePomegranateOrigin(raw) ?? POMEGRANATE_DEFAULT_COORDINATOR_URL
}

export function pomegranateGoogleLoginUrl(centralBase: string): string {
  return `${normalizePomegranateCoordinatorBase(centralBase)}/login/google`
}

/** NIP-46 bunker URI for a handler profile (no secret; central doubles as the NIP-46 relay). */
export function pomegranateBunkerUrl(centralBase: string, handlerPubkey: string): string {
  const central = normalizePomegranateCoordinatorBase(centralBase)
  const relay = central.replace(/^http/, 'ws')
  return `bunker://${handlerPubkey.trim().toLowerCase()}?relay=${encodeURIComponent(relay)}`
}

export function loadStoredPomegranateCoordinatorUrl(): string {
  try {
    return (
      window.localStorage.getItem(POMEGRANATE_COORDINATOR_STORAGE_KEY) ||
      POMEGRANATE_DEFAULT_COORDINATOR_URL
    )
  } catch {
    return POMEGRANATE_DEFAULT_COORDINATOR_URL
  }
}

export function storePomegranateCoordinatorUrl(url: string): void {
  try {
    const normalized = normalizePomegranateCoordinatorBase(url)
    if (normalized === POMEGRANATE_DEFAULT_COORDINATOR_URL) {
      window.localStorage.removeItem(POMEGRANATE_COORDINATOR_STORAGE_KEY)
    } else {
      window.localStorage.setItem(POMEGRANATE_COORDINATOR_STORAGE_KEY, normalized)
    }
  } catch {
    /* storage unavailable */
  }
}

/** argon2id(email, "pomegranate", {t:1, m:65536 KiB, p:4}) as lowercase hex (kind-16440 `m` tag). */
export async function pomegranateEmailHashHex(email: string): Promise<string> {
  const out = await argon2idAsync(
    new TextEncoder().encode(email),
    new TextEncoder().encode('pomegranate'),
    { t: 1, m: 65536, p: 4, dkLen: 32 }
  )
  return bytesToHex(out)
}

export function decodePomegranateGoogleToken(raw: string): PomegranateGoogleToken {
  let root: { kind?: number; created_at?: number; tags?: string[][] }
  try {
    root = JSON.parse(atob(raw))
  } catch {
    throw new Error('Invalid Google sign-in token')
  }
  if (root.kind !== POMEGRANATE_KIND_CENTRAL_TOKEN) {
    throw new Error('Invalid Google sign-in token')
  }
  const createdAtSec = Number(root.created_at)
  if (!Number.isFinite(createdAtSec)) {
    throw new Error('Invalid Google sign-in token')
  }
  const createdAtMs = createdAtSec * 1000
  if (Date.now() - createdAtMs > TOKEN_MAX_AGE_MS) {
    throw new Error('Google sign-in token expired, please try again')
  }
  const email =
    (Array.isArray(root.tags) ? root.tags : []).find((tag) => tag?.[0] === 'email')?.[1] ?? ''
  return { raw, email, createdAtMs }
}

async function pomegranateFetch(
  centralBase: string,
  path: string,
  token: PomegranateGoogleToken,
  init?: RequestInit
): Promise<Response> {
  const central = normalizePomegranateCoordinatorBase(centralBase)
  return fetch(`${central}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Token ${token.raw}`
    }
  })
}

export async function fetchPomegranateAccount(
  centralBase: string,
  token: PomegranateGoogleToken
): Promise<PomegranateAccount | null> {
  const response = await pomegranateFetch(centralBase, '/account', token)
  if (response.status === 401) throw new Error('Google session expired, please sign in again')
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to load Pomegranate account (${response.status})`)
  const root = (await response.json().catch(() => null)) as {
    pubkey?: string
    threshold?: number
    email?: string
  } | null
  const pubkey = root?.pubkey?.trim().toLowerCase()
  if (!pubkey || pubkey.length !== 64) return null
  return { email: root?.email ?? null, pubkey, threshold: root?.threshold ?? 0 }
}

export async function listPomegranateProfiles(
  centralBase: string,
  token: PomegranateGoogleToken
): Promise<PomegranateProfile[]> {
  const response = await pomegranateFetch(centralBase, '/profiles', token)
  if (!response.ok) throw new Error(`Failed to load signing profiles (${response.status})`)
  const arr = (await response.json().catch(() => null)) as
    | { name?: string; handler_pubkey?: string }[]
    | null
  if (!Array.isArray(arr)) return []
  return arr.flatMap((obj) => {
    const handler = obj?.handler_pubkey?.trim().toLowerCase()
    if (!handler || handler.length !== 64) return []
    return [{ name: obj?.name ?? 'default', handlerPubkey: handler }]
  })
}

export async function createPomegranateProfile(
  centralBase: string,
  token: PomegranateGoogleToken,
  name: string
): Promise<void> {
  const response = await pomegranateFetch(centralBase, '/profiles', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name })
  })
  if (!response.ok) throw new Error(`Signing profile creation failed (${response.status})`)
}

/**
 * README step 15: use the profile named "default", creating it when absent, then fetch
 * the profile list again (do not trust the create response alone). Never fall back to
 * an arbitrary existing profile — those can carry kind/author/expiration restrictions
 * that silently break signing.
 */
export async function ensurePomegranateDefaultProfile(
  centralBase: string,
  token: PomegranateGoogleToken
): Promise<PomegranateProfile> {
  const isDefault = (p: PomegranateProfile) => p.name.toLowerCase() === 'default'
  const existing = (await listPomegranateProfiles(centralBase, token)).find(isDefault)
  if (existing) return existing
  await createPomegranateProfile(centralBase, token, 'default')
  const created = (await listPomegranateProfiles(centralBase, token)).find(isDefault)
  if (!created) throw new Error('Signing profile "default" was not available after creation')
  return created
}

/**
 * README step 5: existing setups announce themselves as kind-16440 events tagged
 * `["m", argon2id(email…)]` and `["central", <url>]`, so a user who signed up in
 * another client can be routed to their real coordinator.
 */
export async function findExistingPomegranateSetup(
  email: string
): Promise<PomegranateDiscoveredSetup | null> {
  const trimmed = email.trim()
  if (!trimmed) return null
  const pool = new SimplePool()
  try {
    const emailHash = await pomegranateEmailHashHex(trimmed)
    const events: Event[] = await pool.querySync(
      [...POMEGRANATE_SETUP_ANNOUNCEMENT_RELAYS],
      {
        kinds: [POMEGRANATE_KIND_SETUP_ANNOUNCEMENT],
        '#m': [emailHash]
      },
      { maxWait: DISCOVERY_TIMEOUT_MS }
    )
    const announcement = events
      .filter((evt) => evt.kind === POMEGRANATE_KIND_SETUP_ANNOUNCEMENT && verifyEvent(evt))
      .sort((a, b) => b.created_at - a.created_at)[0]
    if (!announcement) return null
    const central = massagePomegranateOrigin(
      announcement.tags.find((tag) => tag[0] === 'central')?.[1]
    )
    if (!central) return null
    return { centralUrl: central, userPubkey: announcement.pubkey.trim().toLowerCase() }
  } catch {
    return null
  } finally {
    pool.close([...POMEGRANATE_SETUP_ANNOUNCEMENT_RELAYS])
  }
}

/**
 * Pomegranate login for existing accounts only, per the README implementation guide:
 * Google token (steps 2–4) → kind-16440 setup discovery with user confirmation when
 * another central is found (step 5) → GET /account (step 6) → ensure the "default"
 * profile (step 15) → bunker:// (step 16). The caller connects NIP-46.
 *
 * New-account FROST registration (steps 8–14) is intentionally not implemented;
 * accounts must be created elsewhere (e.g. the Pomegranate admin) first.
 *
 * @param authenticate opens `{central}/login/google` and resolves the raw central token
 *   (web: popup + `window.opener.postMessage({ token })` from the callback page).
 * @param confirmAlternateCentral invoked when a kind-16440 announcement points at a
 *   different central. Return true to re-authenticate there, or false to cancel.
 */
export async function pomegranateLogin(
  centralBase: string,
  authenticate: (centralUrl: string) => Promise<string>,
  confirmAlternateCentral: (discoveredCentralUrl: string) => Promise<boolean> = async () => true
): Promise<PomegranateLoginResult> {
  let central = normalizePomegranateCoordinatorBase(centralBase)
  let token = decodePomegranateGoogleToken(await authenticate(central))

  const setup = await findExistingPomegranateSetup(token.email)
  if (setup && setup.centralUrl !== central) {
    if (!(await confirmAlternateCentral(setup.centralUrl))) {
      throw new PomegranateLoginCancelledError()
    }
    central = setup.centralUrl
    token = decodePomegranateGoogleToken(await authenticate(central))
  }

  const account = await fetchPomegranateAccount(central, token)
  if (!account) {
    throw new Error(
      'No existing Pomegranate account was found for this Google login. ' +
        'This app only signs in to existing accounts — create one once at ' +
        "https://pomegranate-admin.netlify.app (or your coordinator's admin), " +
        'then sign in here again.'
    )
  }

  if (setup && account.pubkey !== setup.userPubkey) {
    throw new Error(
      `The coordinator at ${central} returned a different key than the one ` +
        'in your published setup announcement. Refusing to continue.'
    )
  }

  const profile = await ensurePomegranateDefaultProfile(central, token)
  return {
    bunkerUrl: pomegranateBunkerUrl(central, profile.handlerPubkey),
    centralUrl: central
  }
}
