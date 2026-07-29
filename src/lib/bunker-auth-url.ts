/**
 * Amber / NIP-46 auth URL policy (ported from imwald-android BunkerAuthUrlPolicy).
 * Bare `nostrsigner:` wakes must not be opened — they flash Amber's empty
 * "Nothing to approve" screen before a real request is queued.
 */

const ALLOWED_HTTPS_HOSTS = new Set([
  'signer.getalby.com',
  'app.nsec.app',
  'useamber.com',
  'nostrsigner.com'
])

export function isBareNostrSignerWakeUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed.toLowerCase().startsWith('nostrsigner:')) return false
  const payload = trimmed.slice('nostrsigner:'.length).trim()
  if (payload.length === 0 || payload === '//') return true
  // Real NIP-55 sign requests embed JSON; everything else is a wake hint.
  return !payload.startsWith('{') && !payload.toLowerCase().startsWith('%7b')
}

export function shouldOpenBunkerAuthUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.toLowerCase().startsWith('nostrsigner:')) {
    return !isBareNostrSignerWakeUrl(trimmed)
  }
  if (trimmed.toLowerCase().startsWith('nostrconnect:')) return true
  if (trimmed.toLowerCase().startsWith('https://')) {
    try {
      const host = new URL(trimmed).host.toLowerCase()
      return ALLOWED_HTTPS_HOSTS.has(host)
    } catch {
      return false
    }
  }
  return false
}

/** Open a bunker/NostrConnect auth URL when safe; ignore Amber wake hints. */
export function openBunkerAuthUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed) return
  if (isBareNostrSignerWakeUrl(trimmed)) return
  if (!shouldOpenBunkerAuthUrl(trimmed)) return
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

/** Map common Amber/bunker rejection strings to actionable copy. */
export function friendlyBunkerLoginError(message: string | undefined | null): string {
  const raw = (message ?? '').trim()
  if (raw.toLowerCase() === 'already connected') {
    return (
      'This bunker link was already used. In Amber, create a new bunker connection ' +
      '(or reset this one) and paste the new bunker:// link. Or use NostrConnect / Open Amber.'
    )
  }
  if (
    raw.toLowerCase() === 'invalid secret' ||
    raw.toLowerCase() === 'no secret' ||
    raw.toLowerCase() === 'secret not in use'
  ) {
    return 'Amber rejected this bunker secret. Create a fresh bunker connection in Amber and paste that link.'
  }
  if (raw.toLowerCase() === 'no permission') {
    return 'Amber has no permission for this connection. Create a new bunker connection in Amber and paste that link.'
  }
  if (!raw) return 'Bunker login failed'
  return raw
}
