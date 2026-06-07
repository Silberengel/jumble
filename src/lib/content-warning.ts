import type { Event } from 'nostr-tools'

/** Default NIP-36 `content-warning` tag value (legacy clients also use `t` = nsfw). */
export const DEFAULT_CONTENT_WARNING_LABEL = 'NSFW'

/** Built-in labels for the post editor (stored verbatim in the `content-warning` tag). */
export const CONTENT_WARNING_PRESETS = [
  DEFAULT_CONTENT_WARNING_LABEL,
  'Violence',
  'Trigger warning',
  'Sensitive content',
  'Spoilers'
] as const

export type TContentWarningPreset = (typeof CONTENT_WARNING_PRESETS)[number]

export const CONTENT_WARNING_CUSTOM_SELECT_VALUE = '__custom__'

export function normalizeContentWarningLabel(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return DEFAULT_CONTENT_WARNING_LABEL
  return trimmed.slice(0, 80)
}

export function buildContentWarningTag(label?: string | null): string[] {
  return ['content-warning', normalizeContentWarningLabel(label)]
}

/** Read NIP-36 label from an event (`content-warning` tag, else legacy `t` = nsfw). */
export function getContentWarningLabel(event: Event): string | null {
  const row = event.tags.find(([name]) => name === 'content-warning')
  if (row) {
    const value = row[1]?.trim()
    return value || DEFAULT_CONTENT_WARNING_LABEL
  }
  if (event.tags.some(([name, value]) => name === 't' && value?.toLowerCase() === 'nsfw')) {
    return DEFAULT_CONTENT_WARNING_LABEL
  }
  return null
}

export function isPresetContentWarningLabel(label: string): label is TContentWarningPreset {
  return (CONTENT_WARNING_PRESETS as readonly string[]).includes(label)
}

export type TContentWarningDraftOptions = {
  isNsfw?: boolean
  contentWarningLabel?: string
}

export function contentWarningDraftOptions(
  enabled: boolean,
  label: string
): TContentWarningDraftOptions {
  if (!enabled) return { isNsfw: false }
  return { isNsfw: true, contentWarningLabel: normalizeContentWarningLabel(label) }
}

export function appendContentWarningTagIfNeeded(
  tags: string[][],
  options: TContentWarningDraftOptions
): void {
  if (options.isNsfw) {
    tags.push(buildContentWarningTag(options.contentWarningLabel))
  }
}
