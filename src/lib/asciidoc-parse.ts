/** AsciiDoc → HTML conversion with issue capture and plain-text fallback helpers. */

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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render raw AsciiDoc source as readable paragraphs when conversion fails. */
export function plainAsciiDocSourceToHtml(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  return trimmed
    .split(/\n\s*\n+/)
    .map((block) => {
      const escaped = escapeHtml(block).replace(/\n/g, '<br>')
      return `<p class="whitespace-pre-wrap break-words">${escaped}</p>`
    })
    .join('\n')
}

function formatLoggerMessage(message: {
  getSeverity?: () => unknown
  getText?: () => string
  severity?: unknown
  text?: string
  message?: { text?: string }
}): string {
  const severity = String(message.getSeverity?.() ?? message.severity ?? 'INFO')
  const text = String(message.getText?.() ?? message.text ?? message.message?.text ?? '')
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
