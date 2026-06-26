import { ExtendedKind } from '@/constants'
import { convertAsciiDocViaServer, isAsciiDoctorServerConfigured } from '@/lib/asciidoctor-server-client'
import { eventTagAddress } from '@/lib/publication-index'
import {
  assemblePublicationAsciidoc,
  indexPublicationEvents,
  orderedPublicationRefsFromIndex
} from '@/lib/publication-asciidoc-assembler'
import {
  batchFetchPublicationSectionEvents,
  buildPublicationSectionRelayUrls,
  publicationRefKey
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'

export type PublicationDownloadFormat = 'adoc' | 'epub' | 'pdf'

const MAX_NESTED_PUBLICATIONS = 128
const MAX_TOTAL_EVENTS = 5000

export { isAsciiDoctorServerConfigured }

function safeFilename(title: string, extension: string): string {
  const safe = title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[\W_]+|[\W_]+$/g, '')
  const base = (safe || 'publication').slice(0, 80)
  return `${base}.${extension}`
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function mergeRelayUrls(index: Event, relayUrls: string[]): Promise<string[]> {
  const refs = orderedPublicationRefsFromIndex(index)
  const primary = refs.length
    ? await buildPublicationSectionRelayUrls(index, refs, 40, false)
    : []
  const fallback = refs.length
    ? await buildPublicationSectionRelayUrls(index, refs, 80, true)
    : []
  return [...new Set([...primary, ...fallback, ...relayUrls])]
}

/** Fetch nested publication index + section events for export. */
export async function fetchPublicationTreeForExport(
  rootIndex: Event,
  relayUrls: string[]
): Promise<Map<string, Event>> {
  const fetched = new Map<string, Event>()
  indexPublicationEvents(fetched, [rootIndex])

  const queue: Event[] = [rootIndex]
  const visitedPublicationIds = new Set<string>()
  let traversedPublications = 0

  while (queue.length > 0) {
    const publication = queue.shift()!
    if (visitedPublicationIds.has(publication.id)) continue
    visitedPublicationIds.add(publication.id)
    traversedPublications++

    if (traversedPublications > MAX_NESTED_PUBLICATIONS) break

    const refs = orderedPublicationRefsFromIndex(publication)
    if (refs.length === 0) continue

    const relays = await mergeRelayUrls(publication, relayUrls)
    const resolved = await batchFetchPublicationSectionEvents(refs, relays)

    for (const ref of refs) {
      if (fetched.size >= MAX_TOTAL_EVENTS) break
      const ev = resolved.get(publicationRefKey(ref))
      if (!ev) continue
      indexPublicationEvents(fetched, [ev])
      if (ev.kind === ExtendedKind.PUBLICATION && !visitedPublicationIds.has(ev.id)) {
        queue.push(ev)
      }
    }

    if (fetched.size >= MAX_TOTAL_EVENTS) break
  }

  return fetched
}

export async function assemblePublicationForExport(
  rootIndex: Event,
  relayUrls: string[]
): Promise<ReturnType<typeof assemblePublicationAsciidoc>> {
  const fetched = await fetchPublicationTreeForExport(rootIndex, relayUrls)
  const eventsByAddress = new Map<string, Event>()
  const seenIds = new Set<string>()
  for (const ev of fetched.values()) {
    if (seenIds.has(ev.id)) continue
    seenIds.add(ev.id)
    const addr = eventTagAddress(ev)
    if (addr) eventsByAddress.set(addr, ev)
  }
  const assembled = assemblePublicationAsciidoc(rootIndex, fetched, eventsByAddress)
  if (!assembled.content.trim()) {
    throw new Error('Publication has no exportable content.')
  }
  return assembled
}

export async function exportPublicationDownload(
  rootIndex: Event,
  format: PublicationDownloadFormat,
  relayUrls: string[]
): Promise<{ filename: string }> {
  const assembled = await assemblePublicationForExport(rootIndex, relayUrls)

  if (format === 'adoc') {
    const blob = new Blob([assembled.content], { type: 'text/plain;charset=utf-8' })
    const filename = safeFilename(assembled.title, 'adoc')
    downloadBlob(filename, blob)
    return { filename }
  }

  if (!isAsciiDoctorServerConfigured()) {
    throw new Error('Publication export server is not configured (VITE_ASCIIDOCTOR_SERVER_URL).')
  }

  const serverFormat = format === 'epub' ? 'epub3' : 'pdf'
  // The cover is set via the document's `:front-cover-image:` (+ `:allow-uri-read:` so the converter
  // fetches it). Do NOT pass the image separately: the server's own handling injects a broken cover
  // (manifest references a jacket file it never creates, no `cover-image` property).
  const converted = await convertAsciiDocViaServer(
    serverFormat,
    assembled.content,
    assembled.title,
    assembled.author,
    null
  )
  const filename = safeFilename(assembled.title, converted.extension)
  downloadBlob(filename, converted.blob)
  return { filename }
}
