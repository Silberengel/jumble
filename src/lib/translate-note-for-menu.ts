import { ExtendedKind } from '@/constants'
import { isAsciidocMarkupKind } from '@/lib/advanced-event-lab-kinds'
import {
  translateAdvancedLabMarkup,
  type AdvancedLabMarkupMode
} from '@/lib/advanced-lab-markup-protect'
import { EMBEDDED_EVENT_REGEX } from '@/lib/content-patterns'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { getParentEventHexId } from '@/lib/event'
import { setNoteTranslation } from '@/lib/note-translation-display'
import { normalizeTranslateLangCode } from '@/lib/translate-client'
import { nip19, type Event } from 'nostr-tools'

const CHUNK_MAX = 2500

/** GFM-style blockquote line (indent, `>`, optional space, body). */
const MD_BLOCKQUOTE_LINE = /^([\t ]{0,3})(> ?)(.*)$/

function isMarkdownFenceDelimiterLine(line: string): boolean {
  return /^[\t ]{0,3}```/.test(line.replace(/\r$/u, ''))
}

/**
 * LibreTranslate can leave an isolated middle line in English when each `>` line is translated
 * separately. Coalesce consecutive blockquote bodies (outside fenced code) into one request with
 * embedded newlines preserved via {@link translateAdvancedLabMarkup} options.
 */
async function translateMarkdownBodyCoalescingBlockquotes(text: string, target: string): Promise<string> {
  const lines = text.split(/\r?\n/)
  let inFence = false
  type PlainSeg = { type: 'plain'; lines: string[] }
  type BqSeg = { type: 'bq'; lines: string[] }
  type Seg = PlainSeg | BqSeg
  const segments: Seg[] = []

  const pushPlainLine = (ln: string): void => {
    const last = segments[segments.length - 1]
    if (last?.type === 'plain') last.lines.push(ln)
    else segments.push({ type: 'plain', lines: [ln] })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (isMarkdownFenceDelimiterLine(line)) {
      inFence = !inFence
      pushPlainLine(line)
      i++
      continue
    }
    if (inFence) {
      pushPlainLine(line)
      i++
      continue
    }
    const m = line.match(MD_BLOCKQUOTE_LINE)
    if (m) {
      const runLines: string[] = []
      while (i < lines.length) {
        if (isMarkdownFenceDelimiterLine(lines[i]!)) break
        const m2 = lines[i]!.match(MD_BLOCKQUOTE_LINE)
        if (!m2) break
        runLines.push(lines[i]!)
        i++
      }
      segments.push({ type: 'bq', lines: runLines })
      continue
    }
    pushPlainLine(line)
    i++
  }

  const outs: string[] = []
  for (const seg of segments) {
    if (seg.type === 'plain') {
      const joined = seg.lines.join('\n')
      outs.push(joined === '' ? '' : await translateAdvancedLabMarkup(joined, target, 'auto', 'markdown'))
      continue
    }
    const runLines = seg.lines
    const prefixes: string[] = []
    const bodies: string[] = []
    for (const ln of runLines) {
      const mm = ln.match(MD_BLOCKQUOTE_LINE)!
      prefixes.push(mm[1]! + mm[2]!)
      bodies.push(mm[3] ?? '')
    }
    if (bodies.length === 0) continue
    if (bodies.length === 1) {
      const tb = await translateAdvancedLabMarkup(bodies[0]!, target, 'auto', 'markdown')
      outs.push(`${prefixes[0]}${tb}`)
      continue
    }
    const joinedBodies = bodies.join('\n')
    const translatedJoined = await translateAdvancedLabMarkup(joinedBodies, target, 'auto', 'markdown', {
      preserveEmbeddedNewlinesInTranslatable: true
    })
    const outLines = translatedJoined.split(/\r?\n/)
    if (outLines.length !== bodies.length) {
      const perLine = await Promise.all(
        bodies.map((b) => translateAdvancedLabMarkup(b, target, 'auto', 'markdown'))
      )
      outs.push(prefixes.map((pref, idx) => `${pref}${perLine[idx]}`).join('\n'))
    } else {
      outs.push(prefixes.map((pref, idx) => `${pref}${outLines[idx] ?? ''}`).join('\n'))
    }
  }
  return outs.join('\n')
}

async function translateBodyChunk(
  core: string,
  target: string,
  markupMode: AdvancedLabMarkupMode
): Promise<string> {
  if (core.trim() === '') return ''
  if (markupMode === 'markdown') {
    return translateMarkdownBodyCoalescingBlockquotes(core, target)
  }
  return translateAdvancedLabMarkup(core, target, 'auto', markupMode)
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

/**
 * Same exclusions as the advanced lab (`translateAdvancedLabMarkup`). Chunk large bodies for the API.
 *
 * Trailing whitespace/newlines on a chunk must not be dropped when advancing `rest` (they are not
 * re-sent on the next iteration). Do not `trimStart()` the remainder or blank lines after lists and
 * paragraph breaks vanish from the output.
 */
async function translateLongProtectedBody(
  text: string,
  target: string,
  markupMode: AdvancedLabMarkupMode
): Promise<string> {
  const t = text.trim()
  if (!t) return text
  if (t.length <= CHUNK_MAX) {
    return translateBodyChunk(t, target, markupMode)
  }
  const blocks: string[] = []
  let rest = t
  while (rest.length) {
    let slice = rest.slice(0, CHUNK_MAX)
    const nl = slice.lastIndexOf('\n')
    if (nl > 600) {
      slice = rest.slice(0, nl + 1)
    }
    let endCore = slice.length
    while (endCore > 0 && /\s/u.test(slice[endCore - 1]!)) {
      endCore--
    }
    const core = slice.slice(0, endCore)
    const trailingLiteral = slice.slice(endCore)
    const translated =
      core.trim() === ''
        ? ''
        : await translateBodyChunk(core, target, markupMode)
    blocks.push(translated + trailingLiteral)
    rest = rest.slice(slice.length)
  }
  return blocks.join('')
}

/**
 * @param targetCode LibreTranslate target as returned by `/languages` (e.g. `tr`, `zh-CN`).
 */
export async function translateNoteForDisplay(
  event: Event,
  targetCode: string
): Promise<{ content: string; title?: string }> {
  const target = normalizeTranslateLangCode(targetCode)
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

/**
 * Parent (`e` reply) and `nostr:…` embeds in the body — same scope as prefetch, but not every thread `e` tag.
 */
export function collectRelatedNoteTranslateTargets(event: Event): {
  hexIds: string[]
  nip19Pointers: string[]
} {
  const hexSet = new Set<string>()
  const nip19Set = new Set<string>()
  const self = event.id.toLowerCase()
  const addHex = (id: string | undefined) => {
    if (!id) return
    const h = id.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(h) && h !== self) hexSet.add(h)
  }

  addHex(getParentEventHexId(event))

  const body = event.content ?? ''
  for (const full of body.match(EMBEDDED_EVENT_REGEX) ?? []) {
    const colon = full.indexOf(':')
    if (colon < 0) continue
    const bech32 = full.slice(colon + 1).trim()
    if (!bech32) continue
    try {
      const { type, data } = nip19.decode(bech32)
      if (type === 'note') addHex(data)
      else if (type === 'nevent') addHex(data.id)
      else if (type === 'naddr') nip19Set.add(bech32)
    } catch {
      /* ignore */
    }
  }

  return { hexIds: Array.from(hexSet), nip19Pointers: Array.from(nip19Set) }
}

/**
 * Translates the note body/title and any reply-parent / embedded notes shown with it, then updates the translation store.
 */
export async function translateNoteAndRelatedForDisplay(
  event: Event,
  targetCode: string,
  langLabel: string,
  fetchEvent: (id: string) => Promise<Event | undefined>
): Promise<void> {
  const mainOut = await translateNoteForDisplay(event, targetCode)
  const { hexIds, nip19Pointers } = collectRelatedNoteTranslateTargets(event)
  const coIds: string[] = []
  const seenRel = new Set<string>()
  const self = event.id.toLowerCase()

  const translateRelated = async (rel: Event) => {
    const idl = rel.id.toLowerCase()
    if (idl === self || seenRel.has(idl)) return
    if (!eventHasTranslatableTextBody(rel) && !articleHasTranslatableTitle(rel)) return
    seenRel.add(idl)
    try {
      const out = await translateNoteForDisplay(rel, targetCode)
      setNoteTranslation(rel.id, {
        lang: targetCode,
        langLabel,
        content: out.content,
        title: out.title
      })
      coIds.push(rel.id)
    } catch {
      seenRel.delete(idl)
    }
  }

  for (const hex of hexIds) {
    const rel = await fetchEvent(hex)
    if (rel) await translateRelated(rel)
  }
  for (const ptr of nip19Pointers) {
    const rel = await fetchEvent(ptr)
    if (rel) await translateRelated(rel)
  }

  setNoteTranslation(event.id, {
    lang: targetCode,
    langLabel,
    content: mainOut.content,
    title: mainOut.title,
    coTranslatedIds: coIds.length > 0 ? coIds : undefined
  })
}
