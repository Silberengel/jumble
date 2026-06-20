import { mediaBlobIdentityKey } from '@/lib/imeta-content-match'
import { canUseNostrBuildThumb, toNostrBuildThumbUrl } from '@/lib/nostr-build'
import { cleanUrl, isImage, resolvePrimalBlossomPlayableUrl } from '@/lib/url'
import type { TImetaInfo } from '@/types'
import type { CSSProperties } from 'react'

export type ImetaDim = { width: number; height: number }

/** NIP-94 `dim WIDTHxHEIGHT` → CSS aspect-ratio for layout reservation. */
export function aspectRatioStyleFromDim(dim?: ImetaDim | null): CSSProperties | undefined {
  if (dim && dim.width > 0 && dim.height > 0) {
    return { aspectRatio: `${dim.width} / ${dim.height}` }
  }
  return undefined
}

/**
 * Low-res image suitable for placeholder layers (`thumb`, then video poster `image`).
 * Skips non-images and URLs identical to the main media URL (e.g. thumb wrongly set to .mp4).
 * When no imeta preview is declared, i.nostr.build images use `/thumb/…` (same as profile avatars).
 */
export function imetaPreviewImageUrl(
  info: Pick<TImetaInfo, 'url' | 'thumb' | 'image'>
): string | undefined {
  const main = cleanUrl(info.url)?.trim()
  for (const raw of [info.thumb, info.image]) {
    const c = cleanUrl(raw ?? '')?.trim()
    if (!c || !isImage(c)) continue
    if (main && c === main) continue
    return resolvePrimalBlossomPlayableUrl(c)
  }
  if (main && isImage(main) && canUseNostrBuildThumb(main)) {
    return toNostrBuildThumbUrl(main)
  }
  return undefined
}

/** Cleaned imeta URL → declared dimensions (for inline video / gallery layout). */
export function buildImetaDimMap(infos: Pick<TImetaInfo, 'url' | 'dim'>[]): Map<string, ImetaDim> {
  const map = new Map<string, ImetaDim>()
  for (const info of infos) {
    const cleaned = cleanUrl(info.url)
    if (!cleaned || !info.dim?.width || !info.dim?.height) continue
    map.set(cleaned, info.dim)
  }
  return map
}

/** Resolve imeta row for a media URL (exact match, then same blob via `x` / blossom path). */
export function resolveImetaInfoForUrl(url: string, infos: readonly TImetaInfo[]): TImetaInfo | undefined {
  const cleaned = cleanUrl(url)
  if (!cleaned) return undefined

  for (const info of infos) {
    const ic = cleanUrl(info.url)
    if (ic === cleaned) return { ...info, url: cleaned }
  }

  const blobKey = mediaBlobIdentityKey(cleaned)
  if (!blobKey) return undefined

  for (const info of infos) {
    const ic = cleanUrl(info.url)
    if (!ic) continue
    if (mediaBlobIdentityKey(ic, info.x) === blobKey) {
      return { ...info, url: cleaned }
    }
  }

  return undefined
}

/** Poster still for video/audio placeholders — skips non-image `thumb` (e.g. .mp4). */
export function mediaPosterUrlFromImeta(
  info: Pick<TImetaInfo, 'url' | 'thumb' | 'image'> | undefined
): string | undefined {
  if (!info) return undefined
  return imetaPreviewImageUrl(info)
}
