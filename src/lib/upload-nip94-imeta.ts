import { encode as encodeBlurhash } from 'blurhash'

/** NIP-94-style `[name, value]` rows before folding into a single `imeta` tag (NIP-92). */

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.apng': 'image/apng',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mka': 'audio/x-matroska',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac'
}

function extFromName(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function guessMimeFromFile(file: File): string | undefined {
  if (file.type && file.type.trim() !== '') {
    return file.type
  }
  const ext = extFromName(file.name)
  return EXT_TO_MIME[ext]
}

export async function sha256HexOfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function imageDimensionsFromFile(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const width = bmp.width
    const height = bmp.height
    bmp.close()
    if (width > 0 && height > 0) {
      return { width, height }
    }
  } catch {
    // unsupported decode / HEIC / etc.
  }
  return null
}

function videoDimensionsFromFile(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const done = (dims: { width: number; height: number } | null) => {
      URL.revokeObjectURL(objectUrl)
      resolve(dims)
    }
    video.onloadedmetadata = () => {
      const w = video.videoWidth
      const h = video.videoHeight
      done(w > 0 && h > 0 ? { width: w, height: h } : null)
    }
    video.onerror = () => done(null)
    video.src = objectUrl
  })
}

function shouldTryBlurhash(mime: string | undefined): boolean {
  if (!mime || !mime.startsWith('image/')) return false
  if (mime === 'image/svg+xml') return false
  return true
}

async function blurhashFromRasterFile(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file)
    const maxSide = 64
    let w = bmp.width
    let h = bmp.height
    const scale = Math.min(1, maxSide / Math.max(w, h, 1))
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close()
      return null
    }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const { data } = ctx.getImageData(0, 0, w, h)
    return encodeBlurhash(data, w, h, 4, 3)
  } catch {
    return null
  }
}

function isNonEmpty(v: string | undefined): boolean {
  return v != null && v.trim() !== ''
}

/**
 * Merge NIP-94 tag pairs: start from client, then let the server overwrite any key
 * it supplies with a non-empty value. `fallback` rows are merged with server first.
 */
export function mergeNip94Pairs(client: string[][], server: string[][]): string[][] {
  const mergedSingle: Record<string, string> = {}
  const clientFallback: string[] = []

  for (const row of client) {
    if (!row?.length || !row[0]) continue
    const k = row[0]
    const v = row[1] ?? ''
    if (k === 'fallback') {
      if (isNonEmpty(v)) clientFallback.push(v)
    } else {
      mergedSingle[k] = v
    }
  }

  const serverFallback: string[] = []
  for (const row of server) {
    if (!row?.length || !row[0]) continue
    const k = row[0]
    const v = row[1] ?? ''
    if (k === 'fallback') {
      if (isNonEmpty(v)) serverFallback.push(v)
    } else if (isNonEmpty(v)) {
      mergedSingle[k] = v
    }
  }

  const preferredOrder = ['url', 'm', 'x', 'ox', 'size', 'dim', 'blurhash', 'thumb', 'image', 'alt']
  const used = new Set<string>()
  const out: string[][] = []

  for (const key of preferredOrder) {
    const val = mergedSingle[key]
    if (isNonEmpty(val)) {
      out.push([key, val!])
      used.add(key)
    }
  }

  for (const key of Object.keys(mergedSingle)) {
    if (used.has(key)) continue
    const val = mergedSingle[key]
    if (isNonEmpty(val)) {
      out.push([key, val!])
    }
  }

  const seenFb = new Set<string>()
  for (const f of serverFallback) {
    out.push(['fallback', f])
    seenFb.add(f)
  }
  for (const f of clientFallback) {
    if (!seenFb.has(f)) {
      out.push(['fallback', f])
      seenFb.add(f)
    }
  }

  return out
}

export function nip94PairsToImetaTag(pairs: string[][]): string[] {
  const body = pairs.map(([k, v]) => `${k} ${v}`)
  return ['imeta', ...body]
}

/**
 * Client-side NIP-94 fields for the uploaded bytes (post-compression) and final URL.
 */
export async function buildClientNip94Pairs(file: File, url: string): Promise<string[][]> {
  const pairs: string[][] = [['url', url]]

  const mime = guessMimeFromFile(file)
  if (mime) {
    pairs.push(['m', mime])
  }

  pairs.push(['x', await sha256HexOfFile(file)])
  pairs.push(['size', String(file.size)])

  if (mime?.startsWith('image/')) {
    const dim = await imageDimensionsFromFile(file)
    if (dim) {
      pairs.push(['dim', `${dim.width}x${dim.height}`])
    }
    if (shouldTryBlurhash(mime)) {
      const bh = await blurhashFromRasterFile(file)
      if (bh) {
        pairs.push(['blurhash', bh])
      }
    }
  } else if (mime?.startsWith('video/')) {
    const dim = await videoDimensionsFromFile(file)
    if (dim) {
      pairs.push(['dim', `${dim.width}x${dim.height}`])
    }
  }

  return pairs
}
