import {
  applyImwaldAttributionTags,
  collectUploadImetaTagsForContentUrls,
  mergeUploadImetaTagsInto
} from '@/lib/draft-event'
import type { TDraftEvent } from '@/types'

export type AdvancedEventLabSlice = {
  kind: number
  content: string
  tags: string[][]
}

/**
 * JSON shaped like the draft passed to publish: merges `imeta` from content URLs,
 * then applies Imwald `client` (and strips duplicate client/attribution tags) like {@link applyImwaldAttributionTags}.
 */
export function serializePublishPreviewLabJson(
  slice: AdvancedEventLabSlice,
  options?: { addClientTag?: boolean }
): string {
  const tags = slice.tags.map((row) => [...row])
  mergeUploadImetaTagsInto(tags, collectUploadImetaTagsForContentUrls(slice.content))
  const draft: TDraftEvent = {
    kind: slice.kind,
    content: slice.content,
    created_at: Math.floor(Date.now() / 1000),
    tags
  }
  const withAttribution = applyImwaldAttributionTags(draft, {
    addClientTag: options?.addClientTag
  })
  return JSON.stringify(
    {
      kind: withAttribution.kind,
      content: withAttribution.content,
      created_at: withAttribution.created_at,
      tags: withAttribution.tags
    },
    null,
    2
  )
}

export function serializeLabSlice(slice: AdvancedEventLabSlice): string {
  return JSON.stringify(
    {
      kind: slice.kind,
      content: slice.content,
      tags: slice.tags
    },
    null,
    2
  )
}

/**
 * Accepts lab slice JSON or a fuller draft/event object; ignores unknown top-level fields
 * (`created_at`, `pubkey`, `id`, etc.).
 */
export function parseLabSlice(
  raw: string
): { ok: true; value: AdvancedEventLabSlice } | { ok: false; error: string } {
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    return { ok: false, error: 'Root must be an object' }
  }
  const rec = o as Record<string, unknown>
  if (typeof rec.kind !== 'number' || !Number.isFinite(rec.kind) || !Number.isInteger(rec.kind)) {
    return { ok: false, error: '`kind` must be an integer' }
  }
  if (typeof rec.content !== 'string') {
    return { ok: false, error: '`content` must be a string' }
  }
  if (!Array.isArray(rec.tags)) {
    return { ok: false, error: '`tags` must be an array' }
  }
  const tags: string[][] = []
  for (let i = 0; i < rec.tags.length; i++) {
    const row = rec.tags[i]
    if (!Array.isArray(row) || !row.every((c) => typeof c === 'string')) {
      return { ok: false, error: `tags[${i}] must be an array of strings` }
    }
    tags.push([...row])
  }
  return { ok: true, value: { kind: rec.kind, content: rec.content, tags } }
}
