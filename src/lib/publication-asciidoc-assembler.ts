import { ExtendedKind } from '@/constants'
import {
  getPublicationIndexMetadataFromEvent,
  type PublicationIndexMetadata
} from '@/lib/event-metadata'
import { eventTagAddress } from '@/lib/publication-index'
import { pubkeyToNpub } from '@/lib/pubkey'
import {
  parsePublicationATagCoordinate,
  publicationRefKey,
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

/**
 * Reduce a publication `l` tag value (e.g. `"en, ISO-639-1"`) to a bare BCP-47 code so the
 * converter emits a valid `xml:lang` / `dc:language`. Returns undefined when no usable code.
 */
function sanitizeLanguageCode(value: string | undefined): string | undefined {
  const first = value?.split(',')[0].trim()
  if (!first) return undefined
  return /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(first) ? first : undefined
}

/** Max width (px) for the cover shown on the title page. Also capped by the EPUB `img { max-width }`. */
const TITLE_PAGE_COVER_WIDTH = 250

/**
 * Build a visible title page (cover + key metadata) as the document preamble.
 *
 * This is shown in addition to the real `:front-cover-image:` cover. The title-page copy is a plain
 * block image constrained to {@link TITLE_PAGE_COVER_WIDTH} (and the bundled stylesheet's
 * `img { max-width: 100% }`), so it scales to the page, and it surfaces the NKBIP-01 index metadata.
 */
function buildTitlePage(
  title: string,
  author: string,
  image: string,
  metadata: PublicationIndexMetadata
): string[] {
  const parts: string[] = []
  if (image) {
    parts.push(`image::${image}[Cover,${TITLE_PAGE_COVER_WIDTH}]`, '')
  }
  parts.push('[discrete]', `== ${escapeInline(title)}`, '')
  if (author) parts.push(`_by ${escapeInline(author)}_`, '')

  const rows: Array<[string, string]> = []
  if (metadata.version?.trim()) rows.push(['Edition', metadata.version.trim()])
  if (metadata.type?.trim()) rows.push(['Type', metadata.type.trim()])
  const language = sanitizeLanguageCode(metadata.language)
  if (language) rows.push(['Language', language])
  if (metadata.releaseDate?.trim()) rows.push(['Released', metadata.releaseDate.trim()])
  if (metadata.source?.trim()) rows.push(['Source', metadata.source.trim()])
  if (metadata.tags.length > 0) rows.push(['Keywords', metadata.tags.join(', ')])

  for (const [term, value] of rows) {
    parts.push(`${escapeInline(term)}:: ${escapeInline(value)}`)
  }
  if (rows.length > 0) parts.push('')

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

function authorFromMetadata(metadata: PublicationIndexMetadata, pubkey: string): string {
  if (metadata.authors.length > 0) {
    return metadata.authors
      .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
      .join('; ')
  }
  return pubkeyToNpub(pubkey) ?? pubkey
}

/** Ordered `a` / `e` refs from index tags (NKBIP-01 section order). */
export function orderedPublicationRefsFromIndex(event: Event): PublicationSectionRef[] {
  const refs: PublicationSectionRef[] = []
  let tagOrder = 0
  for (const tag of event.tags) {
    const name = (tag[0] || '').trim().toLowerCase()
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
    } else if (name === 'e' && tag[1]) {
      refs.push({ type: 'e', eventId: tag[1], relay: tag[2], tagOrder: tagOrder++ })
    }
  }
  return refs
}

function resolveRefEvent(
  ref: PublicationSectionRef,
  fetched: Map<string, Event>
): Event | undefined {
  return fetched.get(publicationRefKey(ref))
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
