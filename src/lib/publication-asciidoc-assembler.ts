import { ExtendedKind } from '@/constants'
import {
  getPublicationIndexMetadataFromEvent,
  type PublicationIndexMetadata
} from '@/lib/event-metadata'
import { eventTagAddress } from '@/lib/publication-index'
import { pubkeyToNpub } from '@/lib/pubkey'
import {
  parsePublicationATagCoordinate,
  resolvePublicationRefEvent,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import { uppercaseRomanNumeralsInText } from '@/lib/roman-numeral-display'
import type { Event } from 'nostr-tools'

const MAX_NEST_DEPTH = 8

export type AssembledPublicationAsciidoc = {
  content: string
  title: string
  author: string
  image: string
}

function escapeInline(value: string): string {
  return value.replace(/\n/g, ' ')
}

/** Escape text for inclusion in the XHTML passthrough title page (EPUB). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escape a value for use inside a double-quoted XHTML attribute. */
function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

/**
 * Reduce a publication `l` tag value (e.g. `"en, ISO-639-1"`) to a bare BCP-47 code so the
 * converter emits a valid `xml:lang` / `dc:language`. Returns undefined when no usable code.
 */
function sanitizeLanguageCode(value: string | undefined): string | undefined {
  const first = value?.split(',')[0].trim()
  if (!first) return undefined
  return /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(first) ? first : undefined
}

/** Max width (px) for the cover shown on the EPUB title page. Also capped by `img { max-width }`. */
const TITLE_PAGE_COVER_WIDTH = 250

type TitlePageRow = { label: string; value: string; href?: string }

/** Secondary metadata shown below the title (omits anything already on the title heading/cover). */
function titlePageRows(metadata: PublicationIndexMetadata): TitlePageRow[] {
  const rows: TitlePageRow[] = []
  if (metadata.version?.trim()) rows.push({ label: 'Edition', value: metadata.version.trim() })
  const type = metadata.type?.trim()
  if (type && type.toLowerCase() !== 'book') rows.push({ label: 'Type', value: type })
  const language = sanitizeLanguageCode(metadata.language)
  if (language) rows.push({ label: 'Language', value: language })
  if (metadata.releaseDate?.trim()) {
    rows.push({ label: 'Released', value: metadata.releaseDate.trim() })
  }
  const source = metadata.source?.trim()
  if (source) rows.push({ label: 'Source', value: source, href: source })
  if (metadata.tags.length > 0) rows.push({ label: 'Keywords', value: metadata.tags.join(', ') })
  return rows
}

/**
 * Build a visible title page (cover + key metadata) as the document preamble.
 *
 * - EPUB: asciidoctor-epub3 has no built-in title page and its stylesheet has no text-centering
 *   utility, so we emit an elegant, centered page as scoped XHTML via a passthrough block. The cover
 *   is a centered block image capped at {@link TITLE_PAGE_COVER_WIDTH} (and `img { max-width: 100% }`).
 * - PDF (and other backends): asciidoctor already renders a themed title page from the document
 *   header, and `:front-cover-image:` supplies the cover, so we only add the remaining metadata.
 */
function buildTitlePage(
  title: string,
  author: string,
  image: string,
  metadata: PublicationIndexMetadata
): string[] {
  const rows = titlePageRows(metadata)
  const parts: string[] = []

  parts.push('ifdef::backend-epub3[]')
  if (image) parts.push(`image::${image}[Cover,${TITLE_PAGE_COVER_WIDTH}]`, '')
  parts.push('++++')
  parts.push('<div style="text-align: center; margin: 1.5em 1em;">')
  parts.push(
    `<div style="font-size: 1.8em; font-weight: bold; line-height: 1.25;">${escapeHtml(title)}</div>`
  )
  if (author) {
    parts.push(
      `<div style="font-style: italic; font-size: 1.1em; margin-top: 0.5em;">by ${escapeHtml(author)}</div>`
    )
  }
  if (rows.length > 0) {
    parts.push(
      '<hr style="width: 35%; max-width: 12em; border: 0; border-top: 1px solid #999; margin: 1.5em auto;"/>'
    )
    parts.push('<div style="font-size: 0.95em; line-height: 1.7;">')
    parts.push(
      rows
        .map((row) => {
          const value = row.href
            ? `<a href="${escapeHtmlAttr(row.href)}">${escapeHtml(row.value)}</a>`
            : escapeHtml(row.value)
          return `<span style="color: #555;">${escapeHtml(row.label)}:</span> ${value}`
        })
        .join('<br/>\n')
    )
    parts.push('</div>')
  }
  parts.push('</div>')
  parts.push('++++')
  parts.push('endif::[]')
  parts.push('')

  parts.push('ifndef::backend-epub3[]')
  if (image) parts.push(`image::${image}[Cover,${TITLE_PAGE_COVER_WIDTH},align=center]`, '')
  for (const row of rows) {
    parts.push(`${escapeInline(row.label)}:: ${escapeInline(row.value)}`)
  }
  if (rows.length > 0) parts.push('')
  parts.push('endif::[]')
  parts.push('')

  return parts
}

function heading(level: number, title: string): string {
  const marks = '='.repeat(Math.max(2, Math.min(6, level)))
  return `${marks} ${escapeInline(title)}\n\n`
}

function tagValue(event: Event, name: string): string | undefined {
  for (const tag of event.tags) {
    if ((tag[0] || '').trim().toLowerCase() !== name) continue
    const value = tag[1]?.trim()
    if (value) return value
  }
  return undefined
}

function titleFromIndex(event: Event): string {
  const raw = tagValue(event, 'title') || tagValue(event, 'd') || 'Publication'
  return uppercaseRomanNumeralsInText(raw)
}

const GENERIC_AUTHOR_ROLES = new Set(['author', 'aut'])

function authorFromMetadata(metadata: PublicationIndexMetadata, pubkey: string): string {
  if (metadata.authors.length > 0) {
    return metadata.authors
      .map((a) => {
        const role = a.role?.trim()
        return role && !GENERIC_AUTHOR_ROLES.has(role.toLowerCase())
          ? `${a.name} (${role})`
          : a.name
      })
      .join('; ')
  }
  return pubkeyToNpub(pubkey) ?? pubkey
}

/** Ordered `a` / `e` refs from index tags (NKBIP-01 section order). */
export function orderedPublicationRefsFromIndex(event: Event): PublicationSectionRef[] {
  const refs: PublicationSectionRef[] = []
  let tagOrder = 0
  for (const tag of event.tags) {
    const rawName = (tag[0] || '').trim()
    const name = rawName.toLowerCase()
    if (name === 'a' && tag[1]) {
      const parsed = parsePublicationATagCoordinate(tag[1])
      if (!parsed) continue
      refs.push({
        type: 'a',
        coordinate: parsed.coordinate,
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
        relay: tag[2],
        tagOrder: tagOrder++
      })
    } else if (rawName === 'e' && tag[1]) {
      // Lowercase `e` = section ref. Uppercase `E` = source event (not a section).
      refs.push({ type: 'e', eventId: tag[1], relay: tag[2], tagOrder: tagOrder++ })
    }
  }
  return refs
}

function resolveRefEvent(
  ref: PublicationSectionRef,
  fetched: Map<string, Event>
): Event | undefined {
  return resolvePublicationRefEvent(ref, fetched)
}

function appendIndexBody(
  index: Event,
  eventsByAddress: Map<string, Event>,
  fetched: Map<string, Event>,
  headingLevel: number,
  parts: string[]
): void {
  if (headingLevel > MAX_NEST_DEPTH + 1) return

  for (const ref of orderedPublicationRefsFromIndex(index)) {
    if (ref.type === 'a' && ref.coordinate) {
      const partsCoord = ref.coordinate.split(':')
      const kind = ref.kind ?? parseInt(partsCoord[0], 10)

      if (kind === ExtendedKind.PUBLICATION) {
        const child =
          eventsByAddress.get(ref.coordinate) ?? resolveRefEvent(ref, fetched)
        if (!child) continue

        const sectionTitle = titleFromIndex(child)
        if (sectionTitle) parts.push(heading(headingLevel, sectionTitle))

        const indexContent = child.content.trim()
        if (indexContent) parts.push(`${indexContent}\n\n`)

        appendIndexBody(child, eventsByAddress, fetched, headingLevel + 1, parts)
      } else if (
        kind === ExtendedKind.PUBLICATION_CONTENT ||
        kind === ExtendedKind.WIKI_ARTICLE
      ) {
        const article = resolveRefEvent(ref, fetched)
        if (!article) continue

        let sectionTitle = tagValue(article, 'title')?.trim() || ref.identifier || ''
        if (!sectionTitle && ref.coordinate) {
          sectionTitle = ref.coordinate.split(':').slice(2).join(':')
        }
        if (sectionTitle) parts.push(heading(headingLevel, uppercaseRomanNumeralsInText(sectionTitle)))

        const body = article.content.trim()
        if (body) parts.push(`${body}\n\n`)
      }
    } else if (ref.type === 'e') {
      const article = resolveRefEvent(ref, fetched)
      if (!article) continue
      const sectionTitle = uppercaseRomanNumeralsInText(
        tagValue(article, 'title')?.trim() || 'Section'
      )
      parts.push(heading(headingLevel, sectionTitle))
      const body = article.content.trim()
      if (body) parts.push(`${body}\n\n`)
    }
  }
}

/** Build a single AsciiDoc book document (matches unfold {@link PublicationAsciidocAssembler}). */
export function assemblePublicationAsciidoc(
  rootIndex: Event,
  fetched: Map<string, Event>,
  eventsByAddress: Map<string, Event>
): AssembledPublicationAsciidoc {
  const metadata = getPublicationIndexMetadataFromEvent(rootIndex)
  const title = metadata.title?.trim() || titleFromIndex(rootIndex)
  const author = authorFromMetadata(metadata, rootIndex.pubkey)
  const image = metadata.image?.trim() ?? ''
  const version =
    metadata.version?.trim() || tagValue(rootIndex, 'V')?.trim() || 'first edition'

  const header: string[] = [`= ${escapeInline(title)}`]
  if (author) header.push(escapeInline(author))
  header.push(':doctype: book')
  // Let the converter fetch the remote cover (and any inline images) itself so it can
  // embed them and emit a proper EPUB cover (cover-image property + spine cover page).
  header.push(':allow-uri-read:')
  header.push(':toc:')
  header.push(':toclevels: 2')
  header.push(':stem:')
  header.push(':page-break-mode: auto')
  header.push(':sectnums!:')
  header.push(':imagesdir:')
  header.push(':image-width: 1000px')
  header.push(':max-width: 1000px')
  if (author) header.push(`:author: ${escapeInline(author)}`)
  header.push(`:version: ${escapeInline(version)}`)
  header.push(`:revnumber: ${escapeInline(version)}`)
  if (metadata.releaseDate?.trim()) {
    header.push(`:revdate: ${escapeInline(metadata.releaseDate.trim())}`)
  }
  if (metadata.source?.trim()) {
    header.push(`:source: ${escapeInline(metadata.source.trim())}`)
  }
  if (metadata.type?.trim()) {
    header.push(`:publication-type: ${escapeInline(metadata.type.trim())}`)
  }
  const language = sanitizeLanguageCode(metadata.language)
  if (language) {
    header.push(`:lang: ${escapeInline(language)}`)
  }
  if (image) {
    // Sets the real cover (EPUB cover-image / library thumbnail; PDF cover page). The image-macro
    // form is required by asciidoctor-epub3; a bare path/URL is ignored. The title page below shows
    // a smaller, page-fitted copy of the same image.
    header.push(`:front-cover-image: image:${image}[]`)
  }

  const bodyParts: string[] = []
  bodyParts.push(...buildTitlePage(title, author, image, metadata))
  if (metadata.summary?.trim()) {
    bodyParts.push('[abstract]', '____', metadata.summary.trim(), '____', '')
  }

  appendIndexBody(rootIndex, eventsByAddress, fetched, 2, bodyParts)

  const content = `${header.join('\n')}\n\n${bodyParts.join('\n')}`.trimEnd() + '\n'

  return { content, title, author, image }
}

/** Register events from a batch fetch into address/id maps. */
export function indexPublicationEvents(
  target: Map<string, Event>,
  events: Iterable<Event>
): void {
  for (const event of events) {
    target.set(event.id, event)
    const addr = eventTagAddress(event)
    if (addr) target.set(addr, event)
  }
}
