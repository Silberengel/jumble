import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import {
  clearSitesProxyUnavailableThisSession,
  isSitesProxyUnavailableThisSession,
  markSitesProxyUnavailableFromHttpStatus
} from '@/lib/optional-proxy-session'
import { htmlLooksLikeImwaldAppShell, parseOpenGraphFromHtml } from '@/lib/open-graph'
import {
  buildDevLocalSitesFetchUrl,
  buildViteProxySitesFetchUrl,
  urlLooksLikeViteProxyRequest
} from '@/lib/vite-proxy-url'
import { TWebMetadata } from '@/types'
import DataLoader from 'dataloader'
import logger from '@/lib/logger'

const HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; Imwald/1.0; +https://jumble.imwald.eu)'
}

/** Browser direct fetches: no custom User-Agent (many sites reject it in CORS preflight). */
const HTML_FETCH_HEADERS_DIRECT = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
}

async function tryFetchHtml(
  fetchUrl: string,
  timeoutMs: number,
  options?: { direct?: boolean }
): Promise<{ html: string | null; status?: number }> {
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      timeoutMs,
      mode: 'cors',
      credentials: 'omit',
      headers: options?.direct ? HTML_FETCH_HEADERS_DIRECT : HTML_FETCH_HEADERS
    })
    if (!res.ok) return { html: null, status: res.status }
    const html = await res.text()
    if (html.length < 50) return { html: null, status: res.status }
    if (htmlLooksLikeImwaldAppShell(html)) {
      logger.debug('[WebService] Ignoring app-shell HTML from fetch', { fetchUrl })
      return { html: null, status: res.status }
    }
    return { html }
  } catch {
    return { html: null }
  }
}

type OgFetchAttempt = { label: string; url: string; timeoutMs: number; direct?: boolean }

function buildOgFetchAttempts(originalUrl: string): OgFetchAttempt[] {
  const attempts: OgFetchAttempt[] = []
  const proxyServer = import.meta.env.VITE_PROXY_SERVER?.trim()
  const proxyDown = isSitesProxyUnavailableThisSession()

  if (proxyServer && !proxyDown && !urlLooksLikeViteProxyRequest(originalUrl)) {
    attempts.push({
      label: 'vite-proxy',
      url: buildViteProxySitesFetchUrl(originalUrl, proxyServer),
      timeoutMs: 35_000
    })
  }

  if (import.meta.env.DEV) {
    const devSitesUrl = buildDevLocalSitesFetchUrl(originalUrl)
    if (devSitesUrl && !proxyDown) {
      attempts.push({ label: 'dev-sites', url: devSitesUrl, timeoutMs: 35_000 })
    }
    attempts.push({ label: 'direct', url: originalUrl, timeoutMs: 15_000, direct: true })
  } else if (!proxyServer || proxyDown) {
    attempts.push({ label: 'direct', url: originalUrl, timeoutMs: 15_000, direct: true })
  }

  attempts.push(
    {
      label: 'allorigins',
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(originalUrl)}`,
      timeoutMs: 25_000
    },
    {
      label: 'corsproxy',
      url: `https://corsproxy.io/?${encodeURIComponent(originalUrl)}`,
      timeoutMs: 25_000
    }
  )

  return attempts
}

/**
 * OG HTML: configured `/sites/?url=…` proxy first; then direct (dev or when proxy is down);
 * then public CORS proxies as last resort.
 */
async function fetchHtmlForOpenGraph(originalUrl: string): Promise<{ html: string; via: string } | null> {
  if (urlLooksLikeViteProxyRequest(originalUrl)) {
    const { html } = await tryFetchHtml(originalUrl, 35_000)
    return html ? { html, via: originalUrl } : null
  }

  for (const attempt of buildOgFetchAttempts(originalUrl)) {
    logger.debug('[WebService] OG fetch attempt', {
      originalUrl,
      label: attempt.label,
      fetchUrl: attempt.url
    })
    const result = await tryFetchHtml(attempt.url, attempt.timeoutMs, { direct: attempt.direct })
    if (result.html) {
      if (attempt.label === 'vite-proxy' || attempt.label === 'dev-sites') {
        clearSitesProxyUnavailableThisSession()
      }
      return { html: result.html, via: attempt.label }
    }
    if (
      (attempt.label === 'vite-proxy' || attempt.label === 'dev-sites') &&
      typeof result.status === 'number'
    ) {
      markSitesProxyUnavailableFromHttpStatus(result.status)
    }
  }

  return null
}

class WebService {
  static instance: WebService

  private webMetadataDataLoader = new DataLoader<string, TWebMetadata>(
    async (urls) => {
      return await Promise.all(
        urls.map(async (url) => {
          try {
            const loaded = await fetchHtmlForOpenGraph(url)
            if (!loaded) {
              logger.debug('[WebService] No HTML for OG metadata', { url })
              return {}
            }

            logger.debug('[WebService] Received HTML for OG', {
              url,
              via: loaded.via,
              htmlLength: loaded.html.length
            })

            return parseOpenGraphFromHtml(loaded.html, url)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              logger.warn('[WebService] Fetch aborted (timeout)', { url })
            } else {
              logger.error('[WebService] Failed to fetch OG metadata', { url, error })
            }
            return {}
          }
        })
      )
    },
    { maxBatchSize: 1, batchScheduleFn: (callback) => setTimeout(callback, 100) }
  )

  constructor() {
    if (!WebService.instance) {
      WebService.instance = this
    }
    return WebService.instance
  }

  async fetchWebMetadata(url: string) {
    return await this.webMetadataDataLoader.load(url)
  }
}

const instance = new WebService()

export default instance
