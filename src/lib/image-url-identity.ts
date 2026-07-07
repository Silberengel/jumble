import { cleanUrl, findHttpUrlsInText, isBlossomBudBlobUrl, isImage } from '@/lib/url'

/** UUID-style object keys (e.g. Substack S3 paths embedded in CDN URLs). */
const UUID_IMAGE_FILENAME_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_\d+x\d+\.(?:jpe?g|png|gif|webp|svg|avif))/i

const HASH_IMAGE_FILENAME_RE = /^[a-f0-9]{32,}\.(png|jpg|jpeg|gif|webp|svg|avif)$/i

function readMarkdownParenUrlEnd(content: string, innerStart: number): number {
  let i = innerStart
  while (i < content.length && /\s/.test(content[i]!)) i++

  if (content[i] === '<') {
    const close = content.indexOf('>', i + 1)
    return close === -1 ? -1 : close + 1
  }

  if (!content.startsWith('http', i)) return -1

  let depth = 0
  for (let j = i; j < content.length; j++) {
    const c = content[j]!
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return j + 1
      depth--
    }
  }
  return -1
}

function readMarkdownParenUrl(content: string, innerStart: number): string | null {
  let i = innerStart
  while (i < content.length && /\s/.test(content[i]!)) i++

  if (content[i] === '<') {
    const close = content.indexOf('>', i + 1)
    if (close === -1) return null
    return content.slice(i + 1, close).trim()
  }

  if (!content.startsWith('http', i)) return null

  let depth = 0
  for (let j = i; j < content.length; j++) {
    const c = content[j]!
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return content.slice(i, j)
      depth--
    }
  }
  return null
}

/** Markdown `![](url)`, `![alt](url)`, and `[text](url)` — handles `$`, `,` in URLs plain regex misses. */
export function findMarkdownEmbeddedHttpUrls(content: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  const push = (raw: string | null) => {
    if (!raw) return
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    urls.push(trimmed)
  }

  for (const marker of ['![](', '![](']) {
    let idx = 0
    while ((idx = content.indexOf(marker, idx)) !== -1) {
      push(readMarkdownParenUrl(content, idx + marker.length))
      idx += marker.length
    }
  }

  const altImg = /!\[[^\]]*\]\(/g
  let match: RegExpExecArray | null
  while ((match = altImg.exec(content)) !== null) {
    push(readMarkdownParenUrl(content, match.index + match[0].length))
  }

  let linkIdx = 0
  while ((linkIdx = content.indexOf('](', linkIdx)) !== -1) {
    push(readMarkdownParenUrl(content, linkIdx + 2))
    linkIdx += 2
  }

  return urls
}

/** Strip `[text](url)`, `[![](url)](url)`, and bare `![](url)` for feed card blurbs. */
export function stripMarkdownLinksForBlurb(content: string): string {
  let s = content

  for (const marker of ['![](', '![](']) {
    let i = 0
    while ((i = s.indexOf(marker, i)) !== -1) {
      const linkEnd = readMarkdownParenUrlEnd(s, i + marker.length)
      if (linkEnd === -1) {
        i += marker.length
        continue
      }
      s = `${s.slice(0, i)} ${s.slice(linkEnd)}`
    }
  }

  const altImg = /!\[[^\]]*\]\(/g
  let match: RegExpExecArray | null
  while ((match = altImg.exec(s)) !== null) {
    const linkEnd = readMarkdownParenUrlEnd(s, match.index + match[0].length)
    if (linkEnd === -1) continue
    s = `${s.slice(0, match.index)} ${s.slice(linkEnd)}`
    altImg.lastIndex = match.index
  }

  let i = 0
  while (i < s.length) {
    if (s[i] !== '[' || (i > 0 && s[i - 1] === '!')) {
      i++
      continue
    }
    const closeAlt = s.indexOf('](', i + 1)
    if (closeAlt === -1) break
    const linkEnd = readMarkdownParenUrlEnd(s, closeAlt + 2)
    if (linkEnd === -1) {
      i++
      continue
    }
    s = `${s.slice(0, i)} ${s.slice(linkEnd)}`
  }

  return s
}

/**
 * Stable identity for comparing image URLs that may differ by CDN params or proxy path
 * (e.g. Substack `/image/fetch/.../https%3A%2F%2F.../uuid_WxH.jpeg`).
 */
export function getImageUrlIdentity(url: string): string | null {
  const cleaned = cleanUrl(url)
  if (!cleaned) return null

  try {
    const parsed = new URL(cleaned)
    const pathname = parsed.pathname
    const filename = pathname.split('/').pop() || ''

    if (filename && /^[a-f0-9]{64}$/i.test(filename)) {
      return `blossom-sha256:${filename.toLowerCase()}`
    }

    if (filename && HASH_IMAGE_FILENAME_RE.test(filename)) {
      return filename.toLowerCase()
    }

    const uuidInUrl = cleaned.match(UUID_IMAGE_FILENAME_RE)
    if (uuidInUrl) {
      return uuidInUrl[1].toLowerCase()
    }

    try {
      const decoded = decodeURIComponent(pathname + parsed.search)
      const embedded = decoded.match(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|gif|webp|svg|avif)/i)
      if (embedded) {
        const inner = getImageUrlIdentity(embedded[0])
        if (inner) return inner
      }
    } catch {
      /* ignore decode errors */
    }

    return cleaned
  } catch {
    return cleaned
  }
}

/** Prefix used in Sets that store image identities alongside cleaned URLs. */
export const IMAGE_IDENTITY_SET_PREFIX = '__img_id:'

export function imageIdentitySetKey(identity: string): string {
  return `${IMAGE_IDENTITY_SET_PREFIX}${identity}`
}

/** Collect cleaned media URLs and image identities found in plain/markdown text. */
export function collectMediaUrlKeysInText(content: string): Set<string> {
  const keys = new Set<string>()
  const candidates = [
    ...findHttpUrlsInText(content).map(({ url }) => url),
    ...findMarkdownEmbeddedHttpUrls(content)
  ]

  for (const url of candidates) {
    const cleaned = cleanUrl(url)
    if (
      !cleaned ||
      (!isImage(cleaned) && !isBlossomBudBlobUrl(cleaned))
    ) {
      continue
    }
    keys.add(cleaned)
    const identity = getImageUrlIdentity(cleaned)
    if (identity) {
      keys.add(imageIdentitySetKey(identity))
    }
  }
  return keys
}

/** True when `targetUrl` matches an image URL (or same asset) already in `content`. */
export function isImageUrlPresentInText(content: string, targetUrl: string): boolean {
  const keys = collectMediaUrlKeysInText(content)
  const cleaned = cleanUrl(targetUrl)
  if (cleaned && keys.has(cleaned)) return true
  const identity = getImageUrlIdentity(targetUrl)
  if (identity && keys.has(imageIdentitySetKey(identity))) return true
  return false
}

/** Stable key for deduplicating the same image across URL / blob / host variants. */
export function contentImageRenderKey(url: string): string | null {
  const cleaned = cleanUrl(url)
  if (!cleaned) return null
  const identity = getImageUrlIdentity(cleaned)
  if (identity) return imageIdentitySetKey(identity)
  return cleaned
}

export type ContentImageRenderDeduper = {
  has: (url: string) => boolean
  /** Returns true when this URL may be rendered (first claim); false when already claimed. */
  claim: (url: string) => boolean
}

export function createContentImageRenderDeduper(): ContentImageRenderDeduper {
  const seen = new Set<string>()
  return {
    has(url: string) {
      const key = contentImageRenderKey(url)
      return key != null && seen.has(key)
    },
    claim(url: string) {
      const key = contentImageRenderKey(url)
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }
  }
}
