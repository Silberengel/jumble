import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'

/** Dedupe relay URLs for GIF/meme picker queries (normalized wss URLs). */
export function dedupeMediaPickerRelayUrls(urls: readonly string[]): string[] {
  return dedupeNormalizeRelayUrlsOrdered(urls)
}

export function chunkPubkeys(pubkeys: readonly string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < pubkeys.length; i += size) {
    chunks.push(pubkeys.slice(i, i + size))
  }
  return chunks
}
