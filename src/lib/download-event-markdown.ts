import type { Event } from 'nostr-tools'

function markdownFilename(title: string | undefined): string {
  const base = (title?.trim() || 'document')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${base || 'document'}.md`
}

/** Trigger a browser download of the event body as a `.md` file. */
export function downloadEventAsMarkdownFile(event: Event, title?: string): void {
  const filename = markdownFilename(title)
  const blob = new Blob([event.content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
