import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import {
  clearSitesProxyUnavailableThisSession,
  isSitesProxyUnavailableThisSession,
  markSitesProxyUnavailableFromHttpStatus
} from '@/lib/optional-proxy-session'
import { htmlLooksLikeImwaldAppShell } from '@/lib/open-graph'
import {
  buildDevLocalSitesFetchUrl,
  buildViteProxySitesFetchUrl,
  urlLooksLikeViteProxyRequest
} from '@/lib/vite-proxy-url'
import logger from '@/lib/logger'

const HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; Imwald/1.0; +https://jumble.imwald.eu)'
}

/** Browser direct fetches: no custom User-Agent (many sites reject it in CORS preflight). */
const HTML_FETCH_HEADERS_DIRECT = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
}

type PageFetchAttempt = { label: string; url: string; timeoutMs: number; direct?: boolean }

async function tryFetchPageText(
  fetchUrl: string,
  timeoutMs: number,
  options?: { direct?: boolean }
): Promise<{ text: string | null; status?: number }> {
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      timeoutMs,
      mode: 'cors',
      credentials: 'omit',
      headers: options?.direct ? HTML_FETCH_HEADERS_DIRECT : HTML_FETCH_HEADERS
    })
    if (!res.ok) return { text: null, status: res.status }
    const text = await res.text()
    if (text.length < 1) return { text: null, status: res.status }
    if (htmlLooksLikeImwaldAppShell(text)) {
      logger.debug('[fetchPageHtml] Ignoring app-shell HTML from fetch', { fetchUrl })
      return { text: null, status: res.status }
    }
    return { text }
  } catch {
    return { text: null }
  }
}

function buildPageFetchAttempts(originalUrl: string): PageFetchAttempt[] {
  const attempts: PageFetchAttempt[] = []
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
 * Fetch remote page text via `/sites/?url=…` proxy first, then direct / public CORS fallbacks.
 * Used for OG previews and YouTube transcript extraction.
 */
export async function fetchPageHtml(originalUrl: string): Promise<{ html: string; via: string } | null> {
  if (urlLooksLikeViteProxyRequest(originalUrl)) {
    const { text } = await tryFetchPageText(originalUrl, 35_000)
    return text ? { html: text, via: originalUrl } : null
  }

  for (const attempt of buildPageFetchAttempts(originalUrl)) {
    logger.debug('[fetchPageHtml] fetch attempt', {
      originalUrl,
      label: attempt.label,
      fetchUrl: attempt.url
    })
    const result = await tryFetchPageText(attempt.url, attempt.timeoutMs, { direct: attempt.direct })
    if (result.text) {
      if (attempt.label === 'vite-proxy' || attempt.label === 'dev-sites') {
        clearSitesProxyUnavailableThisSession()
      }
      return { html: result.text, via: attempt.label }
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
