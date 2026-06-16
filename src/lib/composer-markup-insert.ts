/** Shared insert helpers for TipTap + Advanced Lab (CodeMirror) composer surfaces. */

function stripUrlForImageExtensionCheck(url: string): string {
  return url.trim().split(/[#?]/)[0].toLowerCase()
}

export function imageUrlLooksLikeHttpImage(url: string): boolean {
  return /\.(gif|jpe?g|png|webp|avif|bmp|svg)$/i.test(stripUrlForImageExtensionCheck(url))
}

export function labInsertShouldBecomeMarkupImage(txt: string): boolean {
  const t = txt.trim()
  if (!/^https?:\/\//i.test(t)) return false
  if (/^\s*!\[/.test(t)) return false
  if (/^\s*image::/i.test(t)) return false
  if (imageUrlLooksLikeHttpImage(t)) return true
  try {
    const host = new URL(t).hostname.toLowerCase()
    if (host.endsWith('tenor.com') || host.endsWith('giphy.com')) return true
  } catch {
    /* ignore */
  }
  return false
}

export function formatMarkupImageAppend(url: string, asciidoc: boolean): string {
  const safe = url.trim()
  if (asciidoc) return `\nimage::${safe}[Image]\n`
  return `\n![image](${safe})\n`
}

export function formatMarkupImageAtCursor(url: string, asciidoc: boolean): string {
  const safe = url.trim()
  if (asciidoc) return `image::${safe}[Image]`
  return `![image](${safe})`
}

/** Insert plain text or markdown/asciidoc image macro when the lab editor is active. */
export function formatLabInsertText(txt: string, asciidoc: boolean): string {
  return labInsertShouldBecomeMarkupImage(txt) ? formatMarkupImageAtCursor(txt, asciidoc) : txt
}
