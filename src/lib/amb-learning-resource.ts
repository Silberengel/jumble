import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

export type AmbTaxonomyTerm = { term: string; scheme?: string }

export type AmbLearningResource = {
  name: string
  description: string
  language?: string
  /** All `type` tag values (e.g. LearningResource, Image). */
  resourceTypes: string[]
  learningResourceTypeLabel?: string
  aboutLabel?: string
  creatorName?: string
  licenseId?: string
  licenseLabel: string
  isAccessibleForFree: boolean
  contentUrl?: string
  thumbnailUrl?: string
  contentSizeBytes?: number
  contentSha256?: string
  contentFileLabel?: string
  taxonomies: AmbTaxonomyTerm[]
  /** `ext:*` tags (namespace stripped from key). */
  extensions: { key: string; value: string }[]
  client?: string
}

export function isAmbLearningResourceKind(kind: number): boolean {
  return kind === ExtendedKind.LEARNING_RESOURCE
}

function tagValue(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key)?.[1]?.trim() || undefined
}

function prefLabel(tags: string[][], field: string, preferredLang?: string): string | undefined {
  const prefix = `${field}:prefLabel:`
  const matches = tags
    .filter((t) => t[0].startsWith(prefix) && t[1]?.trim())
    .map((t) => ({ lang: t[0].slice(prefix.length), label: t[1].trim() }))

  if (preferredLang) {
    const exact = matches.find((m) => m.lang === preferredLang)
    if (exact) return exact.label
    const primary = preferredLang.split('-')[0]
    const partial = matches.find((m) => m.lang === primary || m.lang.startsWith(`${primary}-`))
    if (partial) return partial.label
  }

  return matches[0]?.label
}

/** Short human label for common Creative Commons license URLs. */
export function formatAmbLicenseLabel(licenseId: string): string {
  try {
    const u = new URL(licenseId)
    if (!u.hostname.includes('creativecommons.org')) return licenseId

    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'publicdomain') {
      if (parts[1] === 'zero') return 'CC0'
      return 'Public Domain'
    }
    if (parts[0] === 'licenses' && parts.length >= 2) {
      const deedParts = parts.slice(1)
      const version =
        deedParts.length > 1 && /^\d/.test(deedParts[deedParts.length - 1])
          ? deedParts.pop()
          : undefined
      const deed = deedParts.map((p) => p.toUpperCase()).join('-')
      return version ? `CC ${deed} ${version}` : `CC ${deed}`
    }
  } catch {
    // fall through
  }
  return licenseId
}

export function formatAmbContentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function guessAmbContentFileLabel(url: string, resourceTypes: string[]): string | undefined {
  if (resourceTypes.some((t) => t.toLowerCase() === 'image')) return 'Image'
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase()
    if (!ext || ext.length > 8) return undefined
    return ext.toUpperCase()
  } catch {
    return undefined
  }
}

/**
 * Parse EduFeed AMB metadata (kind 30142) from event tags.
 * @see https://github.com/edufeed-org/oer-finder-plugin/blob/main/docs/nostr-events.md
 */
export function parseAmbLearningResource(
  event: Pick<Event, 'content' | 'tags'>,
  preferredLang?: string
): AmbLearningResource | null {
  const types = event.tags.filter((t) => t[0] === 'type' && t[1]?.trim()).map((t) => t[1].trim())
  if (!types.some((t) => t === 'LearningResource')) return null

  const name = tagValue(event.tags, 'name') || tagValue(event.tags, 'title')
  const description =
    tagValue(event.tags, 'description') || event.content?.trim() || ''
  if (!name && !description) return null

  const contentUrl = tagValue(event.tags, 'encoding:contentUrl')
  const sizeRaw = tagValue(event.tags, 'encoding:contentSize')
  const contentSizeBytes = sizeRaw ? Number.parseInt(sizeRaw, 10) : undefined

  const taxonomies = event.tags
    .filter((t) => t[0] === 'l' && t[1]?.trim())
    .map((t) => ({ term: t[1].trim(), scheme: t[2]?.trim() || undefined }))

  const extensions = event.tags
    .filter((t) => t[0].startsWith('ext:') && t[1]?.trim())
    .map((t) => ({ key: t[0].slice(4), value: t[1].trim() }))

  const licenseId = tagValue(event.tags, 'license:id')
  const freeRaw = tagValue(event.tags, 'isAccessibleForFree')

  return {
    name: name || description.slice(0, 80) || 'Learning resource',
    description,
    language: tagValue(event.tags, 'inLanguage'),
    resourceTypes: types,
    learningResourceTypeLabel: prefLabel(event.tags, 'learningResourceType', preferredLang),
    aboutLabel: prefLabel(event.tags, 'about', preferredLang),
    creatorName: tagValue(event.tags, 'creator:name'),
    licenseId,
    licenseLabel: licenseId ? formatAmbLicenseLabel(licenseId) : '',
    isAccessibleForFree: freeRaw === 'true',
    contentUrl,
    thumbnailUrl: tagValue(event.tags, 'thumbnail:contentUrl'),
    contentSizeBytes: contentSizeBytes && !Number.isNaN(contentSizeBytes) ? contentSizeBytes : undefined,
    contentSha256: tagValue(event.tags, 'encoding:sha256'),
    contentFileLabel: contentUrl ? guessAmbContentFileLabel(contentUrl, types) : undefined,
    taxonomies,
    extensions,
    client: tagValue(event.tags, 'client')
  }
}
