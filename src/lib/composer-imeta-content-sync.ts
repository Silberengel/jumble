import { looksLikeComposerMediaUrl } from '@/lib/composer-media-url-imeta'
import { cleanUrl, findHttpUrlsInText } from '@/lib/url'

export const COMPOSER_IMETA_CONTENT_SYNC_DEBOUNCE_MS = 450

export function normalizeComposerMediaUrlKey(url: string): string {
  return cleanUrl(url) || url
}

export function imetaUrlFromTagRow(tag: string[]): string | undefined {
  const item = tag.find((x) => typeof x === 'string' && x.startsWith('url '))
  if (!item) return undefined
  return normalizeComposerMediaUrlKey(item.slice(4).trim())
}

/** Media URLs in composer plain text (deduped, stable content order). */
export function extractMediaUrlsFromComposerContent(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (raw: string) => {
    const trimmed = raw.trim().replace(/[)\]},.;]+$/g, '')
    if (!trimmed) return
    let href: string
    try {
      href = new URL(trimmed).toString()
    } catch {
      return
    }
    const cleaned = cleanUrl(href) || href
    if (!looksLikeComposerMediaUrl(cleaned)) return
    const key = normalizeComposerMediaUrlKey(cleaned)
    if (seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  }

  const mdPatterns = [
    /!\[[^\]]*]\(<(https?:\/\/[^>]+)>\)/gi,
    /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi
  ]
  for (const re of mdPatterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      add(m[1]!)
    }
  }

  for (const { url } of findHttpUrlsInText(content)) {
    add(url)
  }

  return out
}

export function composerImetaTagsEqual(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false
  const keysA = a.map(imetaUrlFromTagRow).filter(Boolean).sort()
  const keysB = b.map(imetaUrlFromTagRow).filter(Boolean).sort()
  return keysA.length === keysB.length && keysA.every((k, i) => k === keysB[i])
}

export type ReconcileComposerImetaResult = {
  tags: string[][]
  /** URLs newly linked to imeta (need cache register / optional enrich). */
  addedUrls: string[]
  /** Normalized URL keys dropped from imeta. */
  removedUrlKeys: string[]
}

/**
 * Align composer imeta rows with media URLs in note content: one tag per URL, no orphans.
 */
export function reconcileComposerImetaWithContent(
  content: string,
  existingTags: string[][],
  resolveTag: (url: string) => string[]
): ReconcileComposerImetaResult {
  const contentUrls = extractMediaUrlsFromComposerContent(content)
  const contentKeySet = new Set(contentUrls.map(normalizeComposerMediaUrlKey))

  const tagByKey = new Map<string, string[]>()
  for (const tag of existingTags) {
    const u = imetaUrlFromTagRow(tag)
    if (!u) continue
    const key = normalizeComposerMediaUrlKey(u)
    if (!tagByKey.has(key)) tagByKey.set(key, tag)
  }

  const next: string[][] = []
  const addedUrls: string[] = []

  for (const url of contentUrls) {
    const key = normalizeComposerMediaUrlKey(url)
    const existing = tagByKey.get(key)
    if (existing) {
      next.push(existing)
      tagByKey.delete(key)
    } else {
      next.push(resolveTag(url))
      addedUrls.push(url)
    }
  }

  const removedUrlKeys = [...tagByKey.keys()].filter((k) => !contentKeySet.has(k))

  return { tags: next, addedUrls, removedUrlKeys }
}

export function composerContentHasUploadPlaceholder(content: string): boolean {
  return /\[Uploading "/.test(content) || /\[Error uploading "/.test(content)
}
