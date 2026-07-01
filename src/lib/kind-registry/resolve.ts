import type { Event } from 'nostr-tools'
import type { Source } from './manifest-types'

/** Tag names elevated into structured card sections. */
export const ELEVATED_TAG_NAMES = new Set([
  'title',
  't',
  'summary',
  'description',
  'image',
  'thumb',
  'banner',
  'content',
  'kind',
  'pubkey'
])

export const TECHNICAL_ONLY_TAG_NAMES = new Set(['e', 'p', 'q', 'a', 'nonce'])

export type ElevatedTags = {
  title?: string
  topics: string[]
  summary?: string
  description?: string
  imageUrls: string[]
  tagContent?: string
  declaredKind?: string
  taggedPubkey?: string
}

export function normText(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** Read a manifest Source out of an event. Returns '' when absent. */
export function resolveSource(source: Source, ev: Event): string {
  if (source === 'content') return ev.content ?? ''
  if (source.startsWith('tag:')) {
    const spec = source.slice(4)
    const at = spec.indexOf('@')
    const name = at < 0 ? spec : spec.slice(0, at)
    const idx = at < 0 ? 1 : Math.max(1, Number(spec.slice(at + 1)) || 1)
    return ev.tags.find((t) => t[0] === name)?.[idx] ?? ''
  }
  if (source.startsWith('imeta:')) {
    const field = source.slice(6)
    for (const t of ev.tags) {
      if (t[0] !== 'imeta') continue
      for (const part of t.slice(1)) {
        if (part.startsWith(field + ' ')) return part.slice(field.length + 1)
      }
    }
  }
  return ''
}

export function resolveTemplate(template: string, ev: Event): string {
  return template
    .replace(/\{([^}]+)\}/g, (_, sel) => resolveSource(sel.trim() as Source, ev))
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractElevatedTags(tags: string[][]): ElevatedTags {
  let title: string | undefined
  const topics: string[] = []
  const summaryParts: string[] = []
  const descriptionParts: string[] = []
  const imageUrls: string[] = []
  const contentParts: string[] = []
  let declaredKind: string | undefined
  let taggedPubkey: string | undefined

  for (const tag of tags) {
    const name = tag[0]
    if (!name) continue
    const rest = tag.slice(1).join(' ').trim()
    switch (name) {
      case 'title':
        if (rest && !title) title = rest
        break
      case 't':
        if (rest) topics.push(rest)
        break
      case 'summary':
        if (rest) summaryParts.push(rest)
        break
      case 'description':
        if (rest) descriptionParts.push(rest)
        break
      case 'image':
      case 'thumb':
      case 'banner':
        if (rest) imageUrls.push(rest)
        break
      case 'content':
        if (rest) contentParts.push(rest)
        break
      case 'kind':
        if (rest) declaredKind = rest
        break
      case 'pubkey':
        if (rest) taggedPubkey = rest
        break
      default:
        break
    }
  }

  return {
    title,
    topics,
    summary: summaryParts.length ? summaryParts.join('\n') : undefined,
    description: descriptionParts.length ? descriptionParts.join('\n') : undefined,
    imageUrls,
    tagContent: contentParts.length ? contentParts.join('\n') : undefined,
    declaredKind,
    taggedPubkey
  }
}
