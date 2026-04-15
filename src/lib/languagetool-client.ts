import { LANGUAGE_TOOL_URL } from '@/constants'
import logger from '@/lib/logger'

export type LanguageToolMatch = {
  offset: number
  length: number
  message: string
  replacements?: Array<{ value: string }>
  rule?: { id?: string; description?: string }
}

export type LanguageToolCheckResponse = {
  matches?: LanguageToolMatch[]
  software?: { name?: string; version?: string }
  language?: { name?: string; code?: string }
}

function checkUrl(): string | null {
  const base = LANGUAGE_TOOL_URL.trim().replace(/\/$/u, '')
  if (!base) return null
  return `${base}/v2/check`
}

export async function languageToolCheck(
  text: string,
  language: string,
  signal?: AbortSignal
): Promise<LanguageToolCheckResponse> {
  const url = checkUrl()
  if (!url) {
    return { matches: [] }
  }
  const body = new URLSearchParams()
  body.set('text', text)
  body.set('language', language)
  body.set('enabledOnly', 'false')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    logger.warn('[LanguageTool] HTTP error', { status: res.status, errText: errText.slice(0, 200) })
    throw new Error(`LanguageTool: ${res.status}`)
  }
  return (await res.json()) as LanguageToolCheckResponse
}

export function isLanguageToolConfigured(): boolean {
  return Boolean(checkUrl())
}
