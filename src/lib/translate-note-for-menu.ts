import { ExtendedKind } from '@/constants'
import { isAsciidocMarkupKind } from '@/lib/advanced-event-lab-kinds'
import {
  translateAdvancedLabMarkup,
  type AdvancedLabMarkupMode
} from '@/lib/advanced-lab-markup-protect'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import type { TLanguage } from '@/i18n'
import type { Event } from 'nostr-tools'

const CHUNK_MAX = 2500

/** Map app UI locale codes to LibreTranslate `target` codes where they differ. */
export function translateTargetFromAppLanguage(code: TLanguage): string {
  if (code === 'pt-BR' || code === 'pt-PT') return 'pt'
  return code
}

function looksLikeStringifiedJsonObject(content: string): boolean {
  const trimmed = content.trim()
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return false
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

export function eventHasTranslatableTextBody(event: Event): boolean {
  const c = event.content?.trim() ?? ''
  if (!c) return false
  if (event.kind === ExtendedKind.VOICE || event.kind === ExtendedKind.VOICE_COMMENT) {
    return false
  }
  if (looksLikeStringifiedJsonObject(c)) return false
  return true
}

export function articleHasTranslatableTitle(event: Event): boolean {
  return Boolean(getLongFormArticleMetadataFromEvent(event).title?.trim())
}

/** Same exclusions as the advanced lab (`translateAdvancedLabMarkup`). Chunk large bodies for the API. */
async function translateLongProtectedBody(
  text: string,
  target: string,
  markupMode: AdvancedLabMarkupMode
): Promise<string> {
  const t = text.trim()
  if (!t) return text
  if (t.length <= CHUNK_MAX) {
    return translateAdvancedLabMarkup(t, target, 'auto', markupMode)
  }
  const blocks: string[] = []
  let rest = t
  while (rest.length) {
    let slice = rest.slice(0, CHUNK_MAX)
    const nl = slice.lastIndexOf('\n')
    if (nl > 600) {
      slice = rest.slice(0, nl + 1)
    }
    const part = slice.trimEnd()
    if (part) {
      blocks.push(await translateAdvancedLabMarkup(part, target, 'auto', markupMode))
    }
    rest = rest.slice(slice.length).trimStart()
  }
  return blocks.join('\n')
}

export async function translateNoteForDisplay(
  event: Event,
  appLang: TLanguage
): Promise<{ content: string; title?: string }> {
  const target = translateTargetFromAppLanguage(appLang)
  const markupMode: AdvancedLabMarkupMode = isAsciidocMarkupKind(event.kind) ? 'asciidoc' : 'markdown'
  const meta = getLongFormArticleMetadataFromEvent(event)
  const origTitle = meta.title?.trim()
  const title = origTitle
    ? await translateAdvancedLabMarkup(origTitle, target, 'auto', markupMode)
    : undefined
  const rawContent = event.content ?? ''
  const content = rawContent.trim()
    ? await translateLongProtectedBody(rawContent, target, markupMode)
    : rawContent
  return { content: content || rawContent, title }
}
