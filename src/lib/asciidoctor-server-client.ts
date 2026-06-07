import { ASCIIDOCTOR_SERVER_URL } from '@/constants'

export type AsciiDoctorExportFormat = 'epub3' | 'epub' | 'pdf' | 'html5' | 'html'

const FORMATS: Record<
  AsciiDoctorExportFormat,
  { endpoint: string; mimeType: string; extension: string }
> = {
  epub3: { endpoint: 'epub', mimeType: 'application/epub+zip', extension: 'epub' },
  epub: { endpoint: 'epub', mimeType: 'application/epub+zip', extension: 'epub' },
  pdf: { endpoint: 'pdf', mimeType: 'application/pdf', extension: 'pdf' },
  html5: { endpoint: 'html5', mimeType: 'text/html; charset=utf-8', extension: 'html' },
  html: { endpoint: 'html5', mimeType: 'text/html; charset=utf-8', extension: 'html' }
}

const CONVERT_TIMEOUT_MS = 120_000

export function isAsciiDoctorServerConfigured(): boolean {
  return ASCIIDOCTOR_SERVER_URL.length > 0
}

export function normalizeAsciiDoctorFormat(format: string): AsciiDoctorExportFormat {
  const key = format.trim().toLowerCase()
  if (key === '' || key === 'epub3') return 'epub3'
  if (key in FORMATS) return key as AsciiDoctorExportFormat
  throw new Error(`Unsupported export format: ${format}`)
}

export async function convertAsciiDocViaServer(
  format: AsciiDoctorExportFormat,
  content: string,
  title: string,
  author: string,
  image?: string | null
): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  if (!isAsciiDoctorServerConfigured()) {
    throw new Error('AsciiDoctor server URL is not configured.')
  }

  const normalized = normalizeAsciiDoctorFormat(format)
  const info = FORMATS[normalized]
  const url = `${ASCIIDOCTOR_SERVER_URL.replace(/\/$/, '')}/convert/${info.endpoint}`

  const payload: Record<string, string> = {
    content,
    title: title.trim() || 'Publication',
    author: author.trim()
  }
  const cover = image?.trim()
  if (cover) payload.image = cover

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400)
    throw new Error(
      detail ? `AsciiDoctor server returned HTTP ${response.status}: ${detail}` : `AsciiDoctor server returned HTTP ${response.status}`
    )
  }

  const blob = await response.blob()
  if (blob.size === 0) {
    throw new Error('AsciiDoctor server returned an empty file.')
  }

  return { blob, mimeType: info.mimeType, extension: info.extension }
}
