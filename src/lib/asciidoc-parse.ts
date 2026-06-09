/** AsciiDoc → HTML conversion with issue capture and plain-text fallback helpers. */

import type { LoggerMessage } from '@asciidoctor/core'

export const ASCIIDOC_ARTICLE_CONVERT_ATTRIBUTES: Record<string, unknown> = {
  showtitle: true,
  sectanchors: true,
  sectlinks: true,
  toc: 'left',
  toclevels: 6,
  'toc-title': 'Table of Contents',
  'source-highlighter': 'highlight.js',
  stem: 'latexmath',
  'data-uri': true,
  imagesdir: '',
  linkcss: false,
  stylesheet: '',
  stylesdir: '',
  prewrap: true,
  sectnums: false,
  sectnumlevels: 6,
  experimental: true,
  'compat-mode': false,
  'attribute-missing': 'warn',
  'attribute-undefined': 'warn',
  'skip-front-matter': true
}

export type AsciiDocConversionResult = {
  html: string
  issues: string[]
  /** True when AsciiDoctor.convert threw and no HTML was produced. */
  failed: boolean
}

export type PlainAsciiDocFallbackOptions = {
  /** Remote image URLs from event tags (imeta, image, r) used to resolve `image::file.png[]`. */
  imageUrls?: readonly string[]
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ASCIIDOC_ATTRIBUTE_LINE_RE = /^:([\w-]+):\s*(.*)$/
const ASCIIDOC_IMAGE_MACRO_RE =
  /^image::([^\[]+)\[([^\]]*)\]\s*$|^image:([^\[]+)\[([^\]]*)\]\s*$/

function parseImagesdirFromContent(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const m = line.trim().match(ASCIIDOC_ATTRIBUTE_LINE_RE)
    if (m?.[1] === 'imagesdir') {
      const value = m[2]?.trim()
      if (value) return value
    }
  }
  return undefined
}

function basenameLower(path: string): string {
  const normalized = path.replace(/\\/g, '/').split('/').pop() ?? path
  return normalized.toLowerCase()
}

/** Match `image::media/foo.png[]` to a blossom/imeta URL ending in `foo.png`. */
export function resolveAsciiDocImageSrc(
  path: string,
  imagesdir: string | undefined,
  imageUrls: readonly string[]
): string | undefined {
  const trimmedPath = path.trim()
  if (!trimmedPath) return undefined
  if (/^https?:\/\//i.test(trimmedPath)) return trimmedPath

  const candidates = new Set<string>([trimmedPath, basenameLower(trimmedPath)])
  if (imagesdir) {
    const dir = imagesdir.replace(/\/$/, '')
    candidates.add(`${dir}/${trimmedPath}`.replace(/^\.\//, ''))
    candidates.add(basenameLower(`${dir}/${trimmedPath}`))
  }

  for (const url of imageUrls) {
    const cleaned = url.trim()
    if (!cleaned) continue
    try {
      const pathname = new URL(cleaned).pathname.toLowerCase()
      const file = pathname.split('/').pop() ?? ''
      for (const candidate of candidates) {
        const candidateLower = candidate.toLowerCase()
        if (
          file === basenameLower(candidate) ||
          pathname.endsWith(`/${candidateLower}`) ||
          pathname.includes(`/${candidateLower}`)
        ) {
          return cleaned
        }
      }
    } catch {
      const lower = cleaned.toLowerCase()
      for (const candidate of candidates) {
        if (lower.includes(candidate.toLowerCase())) return cleaned
      }
    }
  }
  return undefined
}

function parseImageMacro(line: string): { path: string; alt: string } | null {
  const m = line.trim().match(ASCIIDOC_IMAGE_MACRO_RE)
  if (!m) return null
  const path = (m[1] || m[3] || '').trim()
  const bracket = (m[2] ?? m[4] ?? '').trim()
  const alt = bracket.split(',')[0]?.trim() || path
  return { path, alt }
}

function renderFallbackImageFigure(
  path: string,
  alt: string,
  imagesdir: string | undefined,
  imageUrls: readonly string[]
): string {
  const src = resolveAsciiDocImageSrc(path, imagesdir, imageUrls)
  if (!src) {
    return `<p class="text-sm italic text-muted-foreground">${escapeHtml(`image::${path}[${alt}]`)}</p>`
  }
  const altHtml = escapeHtml(alt)
  const caption =
    alt && alt !== path
      ? `<figcaption class="mt-2 text-center text-sm text-muted-foreground">${altHtml}</figcaption>`
      : ''
  return `<figure class="my-4 text-center"><img src="${escapeHtml(src)}" alt="${altHtml}" class="mx-auto max-w-full h-auto rounded-lg" loading="lazy" />${caption}</figure>`
}

function renderFallbackHeading(line: string): string | null {
  const symmetric = line.match(/^(={1,6})\s+(.+?)\s+\1$/)
  if (symmetric) {
    const level = Math.min(6, symmetric[1].length)
    return `<h${level} class="font-semibold break-words mb-2 ${level <= 2 ? 'text-2xl' : 'text-xl'}">${escapeHtml(symmetric[2])}</h${level}>`
  }
  const open = line.match(/^(={1,6})\s+(.+)$/)
  if (open) {
    const level = Math.min(6, open[1].length)
    return `<h${level} class="font-semibold break-words mb-2 ${level <= 2 ? 'text-2xl' : 'text-xl'}">${escapeHtml(open[2])}</h${level}>`
  }
  return null
}

function isAttributeLine(line: string): boolean {
  return ASCIIDOC_ATTRIBUTE_LINE_RE.test(line.trim())
}

function isAttributeOnlyBlock(block: string): boolean {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(isAttributeLine)
}

/** Render raw AsciiDoc source as readable HTML when conversion fails. */
export function plainAsciiDocSourceToHtml(
  content: string,
  options?: PlainAsciiDocFallbackOptions
): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  const imageUrls = options?.imageUrls ?? []
  let imagesdir = parseImagesdirFromContent(trimmed)
  const parts: string[] = []

  for (const block of trimmed.split(/\n\s*\n+/)) {
    if (isAttributeOnlyBlock(block)) {
      for (const line of block.split('\n')) {
        const m = line.trim().match(ASCIIDOC_ATTRIBUTE_LINE_RE)
        if (m?.[1] === 'imagesdir') imagesdir = m[2]?.trim() || imagesdir
      }
      continue
    }

    const lines = block.split('\n')
    const firstLine = lines[0]?.trim() ?? ''

    if (lines.length === 1) {
      const heading = renderFallbackHeading(firstLine)
      if (heading) {
        parts.push(heading)
        continue
      }

      const image = parseImageMacro(firstLine)
      if (image) {
        parts.push(renderFallbackImageFigure(image.path, image.alt, imagesdir, imageUrls))
        continue
      }

      if (isAttributeLine(firstLine)) continue
    }

    const escaped = escapeHtml(block).replace(/\n/g, '<br>')
    parts.push(`<p class="whitespace-pre-wrap break-words">${escaped}</p>`)
  }

  return parts.join('\n')
}

/** Patch AsciiDoctor HTML when `image::` paths are local but the blob lives on imeta/r tags. */
export function resolveRelativeImagesInAsciidocHtml(
  html: string,
  content: string,
  imageUrls: readonly string[]
): string {
  if (!html || imageUrls.length === 0) return html
  const imagesdir = parseImagesdirFromContent(content)

  return html.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\ssrc="([^"]*)"/i)
    const altMatch = attrs.match(/\salt="([^"]*)"/i)
    const src = srcMatch?.[1] ?? ''
    const alt = altMatch?.[1] ?? ''

    const brokenDataUri = /^data:[^;]*;base64,?$/i.test(src)
    const isRelative = src && !/^https?:\/\//i.test(src)
    if (!brokenDataUri && !isRelative) return match

    let path = src
    if (brokenDataUri) {
      const fromMacro = [...content.matchAll(/image::?([^\[]+)\[/g)].map((m) => m[1]?.trim()).filter(Boolean)
      path = fromMacro[0] ?? alt
    }

    const resolved = resolveAsciiDocImageSrc(path, imagesdir, imageUrls)
    if (!resolved) return match

    if (srcMatch) {
      return `<img${attrs.replace(/\ssrc="[^"]*"/i, ` src="${escapeHtml(resolved)}"`)}>`
    }
    return `<img src="${escapeHtml(resolved)}"${attrs}>`
  })
}

function formatLoggerMessage(message: LoggerMessage): string {
  const severity = message.getSeverity?.() ?? 'INFO'
  const text = message.getText?.() ?? message.text ?? message.message ?? ''
  return text ? `${severity}: ${text}` : severity
}

/**
 * Convert AsciiDoc source to HTML via AsciiDoctor, capturing warnings and errors.
 * Does not throw — returns `failed: true` with empty html when conversion throws.
 */
export async function convertAsciiDocSource(
  content: string,
  attributes: Record<string, unknown> = ASCIIDOC_ARTICLE_CONVERT_ATTRIBUTES
): Promise<AsciiDocConversionResult> {
  const AsciidoctorModule = await import('@asciidoctor/core')
  const asciidoctor = AsciidoctorModule.default()
  const loggerManager = asciidoctor.LoggerManager
  const defaultLogger = loggerManager.getLogger()
  const memoryLogger = asciidoctor.MemoryLogger.create()
  loggerManager.setLogger(memoryLogger)

  try {
    const result = asciidoctor.convert(content, {
      safe: 'safe',
      backend: 'html5',
      doctype: 'article',
      attributes
    })
    const html = typeof result === 'string' ? result : result.toString()
    const issues = memoryLogger.getMessages().map(formatLoggerMessage).filter(Boolean)
    return { html, issues, failed: false }
  } catch (error) {
    const issues = memoryLogger.getMessages().map(formatLoggerMessage).filter(Boolean)
    const message = error instanceof Error ? error.message : String(error)
    issues.push(`ERROR: ${message}`)
    return { html: '', issues, failed: true }
  } finally {
    loggerManager.setLogger(defaultLogger)
  }
}
