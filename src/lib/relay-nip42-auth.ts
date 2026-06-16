import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools'

/** Resolved (not rejected) by {@link patchPoolRelayAuthRaceAndFeedback} when auth is permanently denied. */
export const NIP42_AUTH_ACCESS_DENIED = '__jumble_nip42_access_denied__'

export class RelayAuthAccessDeniedError extends Error {
  override readonly name = 'RelayAuthAccessDeniedError'

  constructor(message: string) {
    super(message)
  }
}

/** Relay rejected NIP-42 AUTH with a permanent access restriction (membership, allowlist, etc.). */
export function isRelayAuthAccessDeniedMessage(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  if (isRelayAuthTransientFailureMessage(trimmed)) return false
  if (isRelayAuthRequiredCloseReason(trimmed) || isRelayAuthRequiredErrorMessage(trimmed)) {
    return false
  }
  const lower = trimmed.toLowerCase()
  return (
    lower.startsWith('restricted:') ||
    lower.startsWith('forbidden:') ||
    lower.startsWith('blocked:') ||
    /membership required/i.test(trimmed) ||
    /access denied/i.test(trimmed) ||
    /not authorized/i.test(trimmed) ||
    /not allowed/i.test(trimmed)
  )
}

/** Relay membership / auth backend outage — retry later; not a permanent pubkey denial. */
export function isRelayAuthTransientFailureMessage(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  return (
    /temporarily unavailable/i.test(lower) ||
    /try again later/i.test(lower) ||
    /service unavailable/i.test(lower) ||
    /membership check.*unavailable/i.test(lower)
  )
}

function readNip42Challenge(relay: AbstractRelay): string | undefined {
  return (relay as unknown as { challenge?: string }).challenge
}

/**
 * Relays send `CLOSED` with an `auth-required` prefix when NIP-42 authentication is needed.
 * Match upstream jumble `master`: `reason.startsWith('auth-required')` — do **not** require `:`;
 * some relays omit it.
 */
export function isRelayAuthRequiredCloseReason(reason: string): boolean {
  return reason.trim().toLowerCase().startsWith('auth-required')
}

/** Publish / pool errors when the relay requires NIP-42 before accepting EVENT. */
export function isRelayAuthRequiredErrorMessage(message: string): boolean {
  return /auth-required/i.test(message)
}

/** Socket dropped between AUTH and EVENT, or nostr-tools {@link SendingOnClosedConnection}. */
export function isRelayConnectionClosedError(err: unknown): boolean {
  if (err != null && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: unknown }).name)
    if (name === 'SendingOnClosedConnection') return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return /SendingOnClosedConnection|on a closed connection|relay connection closed|websocket closed/i.test(msg)
}

/** nostr-tools default when {@link Subscription.close} runs from the client. */
export function isRelaySubscriptionClosedByCaller(reason: string): boolean {
  return reason.trim() === 'closed by caller'
}

/**
 * Some relays send `CLOSED` (auth-required) in the same tick as or slightly before the `AUTH` challenge
 * is applied; {@link AbstractRelay.auth} throws if `challenge` is still empty. Wait briefly for the frame.
 */
export async function authenticateNip42Relay(
  relay: AbstractRelay,
  signAuthEvent: (evt: EventTemplate) => Promise<VerifiedEvent>,
  options?: { challengeWaitMs?: number; pollMs?: number }
): Promise<string> {
  const challengeWaitMs = options?.challengeWaitMs ?? 4000
  const pollMs = options?.pollMs ?? 25
  const deadline = Date.now() + challengeWaitMs
  while (!readNip42Challenge(relay) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
  }
  if (!readNip42Challenge(relay)) {
    throw new Error(
      "can't perform auth, no challenge was received (timed out waiting for relay AUTH message)"
    )
  }
  const reason = await relay.auth(signAuthEvent)
  if (reason === NIP42_AUTH_ACCESS_DENIED) {
    throw new RelayAuthAccessDeniedError('relay authentication access denied')
  }
  if (isRelayAuthAccessDeniedMessage(reason)) {
    throw new RelayAuthAccessDeniedError(reason)
  }
  return reason
}
