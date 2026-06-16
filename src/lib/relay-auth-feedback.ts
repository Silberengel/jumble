import i18n from '@/i18n'
import { isRelayAuthAccessDeniedMessage, isRelayAuthTransientFailureMessage } from '@/lib/relay-nip42-auth'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import logger from '@/lib/logger'
import { toast } from 'sonner'

/** Many subs / resubscribes call `auth()` on the same relay; one success/reject per URL per tab session is enough. */
const nip42NotifiedAccept = new Set<string>()
const nip42NotifiedReject = new Set<string>()

function sessionKeyForRelay(url: string): string {
  return normalizeUrl(url) || url.trim()
}

function relayLabel(url: string): string {
  const n = normalizeUrl(url) || url
  try {
    return simplifyUrl(n)
  } catch {
    return n
  }
}

/** Relay responded to NIP-42 AUTH with OK — log only (no success toast; routine on many relays). */
export function notifyRelayNip42Accepted(url: string, okReason?: string): void {
  const key = sessionKeyForRelay(url)
  if (!key || nip42NotifiedAccept.has(key)) return
  nip42NotifiedAccept.add(key)
  logger.info('[NIP-42] Auth accepted by relay', { url, okReason })
}

export function notifyRelayNip42TransientFailure(url: string, message: string): void {
  const msg = message.trim() || i18n.t('Relay auth error unknown', { defaultValue: 'Unknown error' })
  logger.info('[NIP-42] Auth temporarily unavailable at relay', { url, message: msg })
}

export function notifyRelayNip42Rejected(url: string, message: string): void {
  const key = sessionKeyForRelay(url)
  const msg = message.trim() || i18n.t('Relay auth error unknown', { defaultValue: 'Unknown error' })
  if (isRelayAuthTransientFailureMessage(msg)) {
    notifyRelayNip42TransientFailure(url, msg)
    return
  }
  if (!key || nip42NotifiedAccept.has(key) || nip42NotifiedReject.has(key)) return
  nip42NotifiedReject.add(key)

  const relay = relayLabel(url)
  if (isRelayAuthAccessDeniedMessage(msg)) {
    toast.info(
      i18n.t('Relay membership required (NIP-42)', {
        relay,
        message: msg,
        defaultValue: `${relay} requires membership or access you don't have — ${msg}`
      })
    )
  } else {
    toast.error(
      i18n.t('Relay auth rejected (NIP-42)', {
        relay,
        message: msg,
        defaultValue: `The relay rejected authentication (NIP-42): ${relay} — ${msg}`
      })
    )
  }
  logger.warn('[NIP-42] Auth rejected by relay', { url, message: msg })
}
