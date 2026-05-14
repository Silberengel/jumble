import logger from '@/lib/logger'

/**
 * When `VITE_PROXY_SERVER` points at a dev stub that returns 502/503/504 for `/sites/?url=…`,
 * remember for the rest of the tab lifetime so OG, NIP-05, and RSS do not hammer the proxy.
 * Cleared on a successful proxy response.
 */
let sitesProxyUnavailableThisSession = false
let sitesProxySkipLogged = false

export function isSitesProxyUnavailableThisSession(): boolean {
  return sitesProxyUnavailableThisSession
}

export function clearSitesProxyUnavailableThisSession(): void {
  sitesProxyUnavailableThisSession = false
  sitesProxySkipLogged = false
}

const BAD_GATEWAYISH = new Set([502, 503, 504])

export function markSitesProxyUnavailableFromHttpStatus(status: number): void {
  if (!BAD_GATEWAYISH.has(status)) return
  if (!sitesProxyUnavailableThisSession) {
    sitesProxyUnavailableThisSession = true
    if (import.meta.env.DEV && !sitesProxySkipLogged) {
      sitesProxySkipLogged = true
      logger.debug(
        '[Optional proxy] Sites proxy returned ' +
          `${status}; skipping further /sites/ proxy fetches this session (direct or fallbacks only).`
      )
    }
  }
}
