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

/**
 * Google OAuth web client id used by {@link POMEGRANATE_DEFAULT_COORDINATOR_URL}
 * (from its `/login/google` redirect). Used for in-page GIS → `/login/google/android`
 * (same mint path the central exposes for native clients).
 */
export const POMEGRANATE_DEFAULT_GOOGLE_CLIENT_ID =
  '300561989816-7nv10jo4vdn0d6p9knf12g7rq4fcusnc.apps.googleusercontent.com'

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

/** Hard ceiling for central HTTP calls (browser fetch has no default timeout). */
const POMEGRANATE_HTTP_TIMEOUT_MS = 15_000

/** Wall-clock limit for kind-16440 relay discovery (includes argon2). */
const SETUP_DISCOVERY_WALL_MS = 10_000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PomegranateLoginCancelledError()
}

function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => !!s)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active)
  const merged = new AbortController()
  for (const signal of active) {
    if (signal.aborted) {
      merged.abort()
      break
    }
    signal.addEventListener('abort', () => merged.abort(), { once: true })
  }
  return merged.signal
}

async function withWallTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T
): Promise<T> {
  let timer = 0
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = window.setTimeout(() => resolve(onTimeout()), ms)
      })
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

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

/** How long to wait for a lucky `postMessage` from the coordinator callback before giving up. */
export const POMEGRANATE_GOOGLE_POPUP_TIMEOUT_MS = 90_000

/**
 * Token from the central callback `postMessage` payload (`{ token }` or a JSON string of that shape).
 */
export function extractPomegranatePostMessageToken(data: unknown): string | null {
  let payload = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }
  const token = (payload as { token?: unknown } | null)?.token
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

function popupIsClosed(popup: Window): boolean {
  try {
    return popup.closed
  } catch {
    // Cross-Origin-Opener-Policy can make `.closed` throw; treat as still open.
    return false
  }
}

/** Ignore flaky `closed===true` during Google's cross-origin redirects. */
const POPUP_CLOSED_GRACE_MS = 8_000
const POPUP_CLOSED_POLLS_REQUIRED = 6

/**
 * Open `{central}/login/google` and await `{ token }` via `postMessage` when `window.opener` survives.
 * Registers the listener **before** `window.open`. After Google COOP, opener is often null and this
 * will time out — callers should offer paste-token as the reliable path.
 *
 * Uses a normal tab (no `popup=` features): small popups often flash the Google account chooser
 * and then report `closed` during redirects, which looked like “nothing happened”.
 */
export function authenticateWithGooglePopup(
  centralUrl: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
  const centralOrigin = normalizePomegranateCoordinatorBase(centralUrl)
  const timeoutMs = options?.timeoutMs ?? POMEGRANATE_GOOGLE_POPUP_TIMEOUT_MS

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let popup: Window | null = null
    let closedTimer = 0
    let timeoutTimer = 0
    let consecutiveClosed = 0
    const openedAt = Date.now()

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      if (closedTimer) window.clearInterval(closedTimer)
      if (timeoutTimer) window.clearTimeout(timeoutTimer)
      options?.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => {
      settle(() => {
        try {
          popup?.close()
        } catch {
          /* ignore */
        }
        reject(new PomegranateLoginCancelledError())
      })
    }

    const onMessage = (event: MessageEvent) => {
      if (massagePomegranateOrigin(event.origin) !== centralOrigin) return
      const token = extractPomegranatePostMessageToken(event.data)
      if (!token) return
      settle(() => {
        try {
          popup?.close()
        } catch {
          /* already closed */
        }
        resolve(token)
      })
    }

    if (options?.signal?.aborted) {
      reject(new PomegranateLoginCancelledError())
      return
    }

    window.addEventListener('message', onMessage)
    options?.signal?.addEventListener('abort', onAbort)

    // Full tab — not a tiny popup. Keep opener (no `noopener`) so a lucky postMessage can work.
    popup = window.open(pomegranateGoogleLoginUrl(centralUrl), '_blank')
    if (!popup) {
      settle(() =>
        reject(new Error('Popup blocked — allow popups for this site and try again'))
      )
      return
    }

    closedTimer = window.setInterval(() => {
      if (Date.now() - openedAt < POPUP_CLOSED_GRACE_MS) return
      if (!popupIsClosed(popup!)) {
        consecutiveClosed = 0
        return
      }
      consecutiveClosed += 1
      if (consecutiveClosed < POPUP_CLOSED_POLLS_REQUIRED) return
      settle(() =>
        reject(
          new Error(
            'Google window closed without returning a token. If it said “Error: No token received.”, sign-in worked — paste document.body.dataset.token below (do not refresh that page).'
          )
        )
      )
    }, 400)

    timeoutTimer = window.setTimeout(() => {
      settle(() => {
        reject(
          new Error(
            'Timed out waiting for Google. The coordinator usually cannot postMessage after Google (browser COOP). Paste the token from the auth tab instead.'
          )
        )
      })
    }, timeoutMs)
  })
}

/** Exchange a Google ID token for a central Token via the Android-compatible endpoint. */
export async function exchangeGoogleIdTokenForCentralToken(
  centralBase: string,
  googleIdToken: string
): Promise<string> {
  const central = normalizePomegranateCoordinatorBase(centralBase)
  const response = await fetch(`${central}/login/google/android`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ id_token: googleIdToken })
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body.trim() || `Google sign-in exchange failed (${response.status})`)
  }
  const root = (await response.json().catch(() => null)) as { token?: string } | null
  const token = root?.token?.trim()
  if (!token) throw new Error('Central returned no sign-in token')
  return token
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
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const central = normalizePomegranateCoordinatorBase(centralBase)
  const timeoutMs = init?.timeoutMs ?? POMEGRANATE_HTTP_TIMEOUT_MS
  const { timeoutMs: _omit, signal: userSignal, ...rest } = init ?? {}
  const timeoutSignal =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  const signal = mergeAbortSignals(userSignal, timeoutSignal)
  try {
    return await fetch(`${central}${path}`, {
      ...rest,
      signal,
      headers: {
        ...(rest.headers ?? {}),
        Authorization: `Token ${token.raw}`
      }
    })
  } catch (err) {
    if (userSignal?.aborted) throw new PomegranateLoginCancelledError()
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`Pomegranate request timed out (${path})`)
    }
    if (err instanceof Error && /aborted|timeout/i.test(err.message)) {
      throw new Error(`Pomegranate request timed out (${path})`)
    }
    throw err
  }
}

export async function fetchPomegranateAccount(
  centralBase: string,
  token: PomegranateGoogleToken,
  options?: { signal?: AbortSignal }
): Promise<PomegranateAccount | null> {
  const response = await pomegranateFetch(centralBase, '/account', token, {
    signal: options?.signal
  })
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
  token: PomegranateGoogleToken,
  options?: { signal?: AbortSignal }
): Promise<PomegranateProfile[]> {
  const response = await pomegranateFetch(centralBase, '/profiles', token, {
    signal: options?.signal
  })
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
  name: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const response = await pomegranateFetch(centralBase, '/profiles', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name }),
    signal: options?.signal
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
  token: PomegranateGoogleToken,
  options?: { signal?: AbortSignal }
): Promise<PomegranateProfile> {
  const isDefault = (p: PomegranateProfile) => p.name.toLowerCase() === 'default'
  const existing = (await listPomegranateProfiles(centralBase, token, options)).find(isDefault)
  if (existing) return existing
  await createPomegranateProfile(centralBase, token, 'default', options)
  const created = (await listPomegranateProfiles(centralBase, token, options)).find(isDefault)
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
 * Google token (steps 2–4) → GET /account on the chosen central (fast path) → optional
 * kind-16440 setup discovery when the account is missing (step 5) → ensure the "default"
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
  confirmAlternateCentral: (discoveredCentralUrl: string) => Promise<boolean> = async () => true,
  options?: {
    signal?: AbortSignal
    onProgress?: (message: string) => void
  }
): Promise<PomegranateLoginResult> {
  const signal = options?.signal
  const onProgress = options?.onProgress
  throwIfAborted(signal)

  let central = normalizePomegranateCoordinatorBase(centralBase)
  onProgress?.('Decoding sign-in token…')
  let token = decodePomegranateGoogleToken(await authenticate(central))
  throwIfAborted(signal)

  // Prefer the chosen central's /account first — skips argon2 + relay discovery when
  // the account already lives here (the common paste-token path).
  onProgress?.('Loading Pomegranate account…')
  let account = await fetchPomegranateAccount(central, token, { signal })
  throwIfAborted(signal)

  let setup: PomegranateDiscoveredSetup | null = null
  if (!account) {
    onProgress?.('Looking for an existing setup…')
    setup = await withWallTimeout(
      findExistingPomegranateSetup(token.email),
      SETUP_DISCOVERY_WALL_MS,
      () => null
    )
    throwIfAborted(signal)
    if (setup && setup.centralUrl !== central) {
      if (!(await confirmAlternateCentral(setup.centralUrl))) {
        throw new PomegranateLoginCancelledError()
      }
      central = setup.centralUrl
      onProgress?.('Signing in at the discovered coordinator…')
      token = decodePomegranateGoogleToken(await authenticate(central))
      throwIfAborted(signal)
      onProgress?.('Loading Pomegranate account…')
      account = await fetchPomegranateAccount(central, token, { signal })
    }
  }

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

  onProgress?.('Loading signing profile…')
  const profile = await ensurePomegranateDefaultProfile(central, token, { signal })
  throwIfAborted(signal)
  return {
    bunkerUrl: pomegranateBunkerUrl(central, profile.handlerPubkey),
    centralUrl: central
  }
}
