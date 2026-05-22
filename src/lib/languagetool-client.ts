import { LANGUAGE_TOOL_URL } from '@/constants'
import { electronAwareFetch } from '@/lib/electron-aware-fetch'
import logger from '@/lib/logger'

/** After proxy/backend 502/503/504, skip further grammar HTTP this tab (optional dev proxy). */
let languageToolBackendGoneThisSession = false
let languageToolOptionalLogged = false

export function isLanguageToolBackendUnreachableThisSession(): boolean {
  return languageToolBackendGoneThisSession
}

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
  if (!url || languageToolBackendGoneThisSession) {
    return { matches: [] }
  }
  const body = new URLSearchParams()
  body.set('text', text)
  body.set('language', language)
  body.set('enabledOnly', 'false')

  const res = await electronAwareFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if ([502, 503, 504].includes(res.status)) {
      languageToolBackendGoneThisSession = true
      if (import.meta.env.DEV && !languageToolOptionalLogged) {
        languageToolOptionalLogged = true
        logger.debug(
          '[LanguageTool] Optional grammar proxy offline; skipping further checks this session.',
          { status: res.status, errText: errText.slice(0, 120) }
        )
      }
      return { matches: [] }
    }
    logger.warn('[LanguageTool] HTTP error', { status: res.status, errText: errText.slice(0, 200) })
    throw new Error(`LanguageTool: ${res.status}`)
  }
  const json = (await res.json()) as LanguageToolCheckResponse
  logger.info('[AdvancedLab] LanguageTool check', {
    language,
    textChars: text.length,
    matchCount: json.matches?.length ?? 0
  })
  return json
}

export function isLanguageToolConfigured(): boolean {
  return Boolean(checkUrl())
}
