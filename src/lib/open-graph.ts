import { TWebMetadata } from '@/types'
import logger from '@/lib/logger'

/** True when HTML is the Vite/React dev shell or another SPA stub, not the target page. */
export function htmlLooksLikeLocalDevAppShell(html: string): boolean {
  const head = html.slice(0, 8000)
  return (
    head.includes('injectIntoGlobalHook') ||
    head.includes('/@vite/') ||
    head.includes('@vite/client') ||
    head.includes('@react-refresh')
  )
}

/** True when HTML is Imwald's SPA index (served when OG proxy is missing or misrouted). */
export function htmlLooksLikeImwaldAppShell(html: string): boolean {
  if (htmlLooksLikeLocalDevAppShell(html)) return true
  const head = html.slice(0, 16_000)
  if (head.includes('imwald-boot-splash') && head.includes('<title>Imwald</title>')) return true
  if (head.includes('jumble.imwald.eu/og-image') && /property="og:title"[^>]*content="Imwald"/i.test(head)) {
    return true
  }
  return false
}

export function isImwaldDefaultOpenGraphTitle(title: string | null | undefined): boolean {
  if (!title) return false
  const t = title.trim()
  return (
    /^imwald$/i.test(t) ||
    t.includes('Imwald ') ||
    /jumble\s*-\s*imwald edition/i.test(t) ||
    /jumble imwald edition/i.test(t)
  )
}

export function isImwaldDefaultOpenGraphDescription(description: string | null | undefined): boolean {
  if (!description) return false
  return /user-friendly nostr client focused on relay feed browsing/i.test(description)
}

function metaContent(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    const v = el?.getAttribute('content') ?? (el as HTMLMetaElement | null)?.content
    if (v?.trim()) return v.trim()
  }
  return undefined
}

function resolveMaybeRelativeUrl(value: string, pageUrl: string): string {
  try {
    const urlObj = new URL(pageUrl)
    if (value.startsWith('/')) {
      return `${urlObj.protocol}//${urlObj.host}${value}`
    }
    if (!value.match(/^https?:\/\//)) {
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
      return `${urlObj.protocol}//${urlObj.host}${basePath}${value}`
    }
    return value
  } catch {
    return value
  }
}

function isFaviconOgImage(image: string): boolean {
  const imageLower = image.toLowerCase()
  return (
    imageLower.includes('/favicon') ||
    imageLower.endsWith('/favicon.ico') ||
    imageLower.endsWith('/favicon.svg')
  )
}

/** Parse Open Graph / Twitter / description meta tags from fetched HTML. */
export function parseOpenGraphFromHtml(html: string, pageUrl: string): TWebMetadata {
  if (htmlLooksLikeImwaldAppShell(html)) {
    logger.debug('[OpenGraph] Ignoring Imwald app shell HTML', { pageUrl })
    return {}
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  let title = metaContent(doc, [
    'meta[property="og:title"]',
    'meta[name="og:title"]',
    'meta[name="twitter:title"]',
    'meta[property="twitter:title"]'
  ])
  if (!title) {
    const titleTag = doc.querySelector('title')?.textContent?.trim()
    if (titleTag) title = titleTag
  }
  if (title) {
    if (
      /^(Redirecting|Loading|Please wait|Redirect)(\.\.\.|…)?$/i.test(title) ||
      title === '...' ||
      title === '…'
    ) {
      title = undefined
    }
  }

  let description = metaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="og:description"]',
    'meta[name="twitter:description"]',
    'meta[property="twitter:description"]',
    'meta[name="description"]'
  ])

  let image = metaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]'
  ])

  let audio = metaContent(doc, [
    'meta[property="og:audio"]',
    'meta[property="og:audio:url"]',
    'meta[property="og:audio:secure_url"]',
    'meta[name="og:audio"]'
  ])

  if (image) {
    try {
      image = resolveMaybeRelativeUrl(image, pageUrl)
      if (isFaviconOgImage(image)) {
        logger.warn('[OpenGraph] Filtered favicon from OG image', { pageUrl, image })
        image = undefined
      }
    } catch (error) {
      logger.warn('[OpenGraph] Failed to resolve image URL', { image, pageUrl, error })
      image = undefined
    }
  }

  if (audio && !audio.match(/^https?:\/\//)) {
    try {
      audio = resolveMaybeRelativeUrl(audio, pageUrl)
      if (!audio.match(/^https?:\/\//)) audio = undefined
    } catch {
      audio = undefined
    }
  }

  try {
    const urlObj = new URL(pageUrl)
    const isAppCanonicalHost = urlObj.hostname === 'jumble.imwald.eu'
    if (!isAppCanonicalHost) {
      if (isImwaldDefaultOpenGraphTitle(title)) title = undefined
      if (isImwaldDefaultOpenGraphDescription(description)) description = undefined
      if (image?.includes('jumble.imwald.eu/og-image')) image = undefined
      if (!title && !description && !image && !audio) {
        logger.debug('[OpenGraph] Stripped Imwald default tags for external URL', {
          url: pageUrl,
          hostname: urlObj.hostname
        })
      }
    }
  } catch {
    /* ignore */
  }

  return { title, description, image, audio }
}
