import { ExtendedKind } from '@/constants'
import { eventTagAddress } from '@/lib/publication-index'
import { uppercaseRomanNumeralsInText } from '@/lib/roman-numeral-display'
import { orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import {
  publicationRefKey,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'

const MAX_NEST_DEPTH = 8

export type PublicationSectionTreeNode = {
  ref: PublicationSectionRef
  event?: Event
  indexEvent: Event
  depth: number
  tagOrder: number
  path: string
  sectionId: string
  title: string
  isPublicationBranch: boolean
  children: PublicationSectionTreeNode[]
}

export type PublicationTocEntry = {
  id: string
  title: string
  depth: number
  tagOrder: number
  path: string
}

function tagValue(event: Event, name: string): string | undefined {
  for (const tag of event.tags) {
    if ((tag[0] || '').trim().toLowerCase() !== name) continue
    const value = tag[1]?.trim()
    if (value) return value
  }
  return undefined
}

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

function sectionLabelMapFromIndex(index: Event): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of index.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue
    const label = tag[3]?.trim()
    if (!label || label.startsWith('wss://') || label.startsWith('ws://') || isHex64(label)) continue
    map.set(tag[1], label)
  }
  return map
}

function coordinateForRef(ref: PublicationSectionRef, event?: Event): string | undefined {
  if (ref.coordinate?.trim()) return ref.coordinate.trim()
  if (event) return eventTagAddress(event) ?? undefined
  return undefined
}

function humanizeIdentifier(identifier: string): string | undefined {
  if (!identifier || isHex64(identifier)) return undefined
  return identifier.replace(/-/g, ' ')
}

function finalizeSectionTitle(title: string): string {
  return uppercaseRomanNumeralsInText(title)
}

export function sectionTitle(
  ref: PublicationSectionRef,
  event: Event | undefined,
  labelMap: Map<string, string>
): string {
  if (event) {
    const title = tagValue(event, 'title')
    if (title) return finalizeSectionTitle(title)
    const dTag = tagValue(event, 'd')
    const humanizedD = dTag ? humanizeIdentifier(dTag) : undefined
    if (humanizedD) return finalizeSectionTitle(humanizedD)
  }

  const coordinate = coordinateForRef(ref, event)
  if (coordinate) {
    const label = labelMap.get(coordinate)
    if (label) return finalizeSectionTitle(label)
  }

  const identifier =
    ref.identifier ??
    (coordinate ? coordinate.split(':').slice(2).join(':') : undefined)
  const humanized = identifier ? humanizeIdentifier(identifier) : undefined
  if (humanized) return finalizeSectionTitle(humanized)

  return 'Section'
}

function sectionAnchorId(path: string, refKey: string): string {
  const slug = refKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug ? `pub-section-${path.replace(/\//g, '-')}-${slug}` : `pub-section-${path.replace(/\//g, '-')}`
}

function resolveRefEvent(
  ref: PublicationSectionRef,
  fetched: Map<string, Event>
): Event | undefined {
  return fetched.get(publicationRefKey(ref))
}

function isPublicationBranchRef(ref: PublicationSectionRef): boolean {
  if (ref.type !== 'a' || !ref.coordinate) return false
  const kind = ref.kind ?? parseInt(ref.coordinate.split(':')[0], 10)
  return kind === ExtendedKind.PUBLICATION
}

/**
 * Build a section tree mirroring each index event's `a` / `e` tag order.
 * Sibling order matches `orderedPublicationRefsFromIndex`; children follow depth-first.
 */
export function buildPublicationSectionTree(
  indexEvent: Event,
  fetched: Map<string, Event>,
  depth = 0,
  pathPrefix = ''
): PublicationSectionTreeNode[] {
  if (depth > MAX_NEST_DEPTH) return []

  const labelMap = sectionLabelMapFromIndex(indexEvent)
  const refs = orderedPublicationRefsFromIndex(indexEvent)
  const nodes: PublicationSectionTreeNode[] = []

  for (const ref of refs) {
    const tagOrder = ref.tagOrder ?? nodes.length
    const event = resolveRefEvent(ref, fetched)
    const coordinate = coordinateForRef(ref, event)
    const refKey = coordinate || publicationRefKey(ref)
    const path = pathPrefix ? `${pathPrefix}/${tagOrder}` : String(tagOrder)
    const isPublicationBranch = isPublicationBranchRef(ref)
    const children =
      isPublicationBranch && event
        ? buildPublicationSectionTree(event, fetched, depth + 1, path)
        : []

    nodes.push({
      ref,
      event,
      indexEvent,
      depth,
      tagOrder,
      path,
      sectionId: sectionAnchorId(path, refKey),
      title: sectionTitle(ref, event, labelMap),
      isPublicationBranch,
      children
    })
  }

  return nodes
}

export function findPublicationSectionNodeByAddress(
  nodes: PublicationSectionTreeNode[],
  targetAddress: string
): PublicationSectionTreeNode | undefined {
  const target = targetAddress.trim().toLowerCase()
  for (const node of nodes) {
    const coord = node.ref.coordinate?.trim().toLowerCase()
    const addr = node.event ? eventTagAddress(node.event)?.toLowerCase() : undefined
    if (coord === target || addr === target) return node
    const nested = findPublicationSectionNodeByAddress(node.children, targetAddress)
    if (nested) return nested
  }
  return undefined
}

/** Depth-first flattening preserves the same order as {@link buildPublicationSectionTree}. */
export function flattenPublicationSectionTreeForToc(
  nodes: PublicationSectionTreeNode[]
): PublicationTocEntry[] {
  const entries: PublicationTocEntry[] = []
  for (const node of nodes) {
    entries.push({
      id: node.sectionId,
      title: node.title,
      depth: node.depth,
      tagOrder: node.tagOrder,
      path: node.path
    })
    if (node.children.length > 0) {
      entries.push(...flattenPublicationSectionTreeForToc(node.children))
    }
  }
  return entries
}
