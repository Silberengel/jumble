import logger from '@/lib/logger'

/** Cooldown after a bad gateway from `/sites/?url=…` before retrying the proxy (ms). */
const SITES_PROXY_RETRY_COOLDOWN_MS = 60_000

/**
 * When the sites proxy returns 502/503/504 (e.g. transient DNS to jumble.imwald.eu), pause proxy
 * attempts briefly so OG/NIP-05/RSS do not hammer it. Cleared on success or when cooldown expires.
 */
let sitesProxyUnavailableUntil = 0
let sitesProxySkipLogged = false

export function isSitesProxyUnavailableThisSession(): boolean {
  return Date.now() < sitesProxyUnavailableUntil
}

export function clearSitesProxyUnavailableThisSession(): void {
  sitesProxyUnavailableUntil = 0
  sitesProxySkipLogged = false
}

const BAD_GATEWAYISH = new Set([502, 503, 504])

export function markSitesProxyUnavailableFromHttpStatus(status: number): void {
  if (!BAD_GATEWAYISH.has(status)) return
  const wasUnavailable = isSitesProxyUnavailableThisSession()
  sitesProxyUnavailableUntil = Date.now() + SITES_PROXY_RETRY_COOLDOWN_MS
  if (import.meta.env.DEV && !wasUnavailable && !sitesProxySkipLogged) {
    sitesProxySkipLogged = true
    logger.debug(
      '[Optional proxy] Sites proxy returned ' +
        `${status}; pausing /sites/ proxy fetches for ${SITES_PROXY_RETRY_COOLDOWN_MS / 1000}s (direct or fallbacks only).`
    )
  }
}
