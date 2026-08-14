/**
 * Expand user-facing identifier paste (URL or bare slug/id) into tag queries.
 * Port of gc_index_relay `GcIndexRelay.Nostr.IdentifierExpander`.
 *
 * Users never type NIP tag syntax. Full URLs match `s` (and often also derive an `i`);
 * bare terms expand to candidate `i` values.
 */

export type IdentifierExpanderQuery = {
  s?: string[]
  i?: string[]
}

function pack(sVals: string[], iVals: string[]): IdentifierExpanderQuery {
  const s = [...new Set(sVals.filter((v) => v !== ''))]
  const i = [...new Set(iVals.filter((v) => v !== ''))]
  const out: IdentifierExpanderQuery = {}
  if (s.length > 0) out.s = s
  if (i.length > 0) out.i = i
  return out
}

function isUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    /^www\./i.test(value) ||
    /^(?:[a-z]{2,3}\.)?(?:wikipedia|gutenberg|openlibrary|wikidata)\.org\//i.test(value)
  )
}

function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function wikiLangFromHost(url: string): string {
  try {
    const host = new URL(url).hostname
    const m = /^([a-z]{2,3})\.wikipedia\.org$/i.exec(host)
    return m ? m[1].toLowerCase() : 'en'
  } catch {
    return 'en'
  }
}

function wikiFromUrl(url: string, path: string): { s: string[]; i: string[] } {
  const m = /\/wiki\/([^?#]+)/i.exec(path)
  if (!m) return { s: [url], i: [] }
  const page = decodeURIComponent(m[1])
  const lang = wikiLangFromHost(url)
  return { s: [url], i: [`wikipedia:${lang}:${page}`] }
}

function expandUrl(raw: string): IdentifierExpanderQuery {
  const url = normalizeUrl(raw)
  let host = ''
  let path = ''
  try {
    const uri = new URL(url)
    host = (uri.hostname || '').toLowerCase()
    path = uri.pathname || ''
  } catch {
    return pack([url], [])
  }

  if (host.includes('wikipedia.org')) {
    const { s, i } = wikiFromUrl(url, path)
    return pack(s, i)
  }

  if (host.includes('gutenberg.org')) {
    const m = /\/ebooks\/(\d+)/i.exec(path)
    return m ? pack([url], [`gutenberg:${m[1]}`]) : pack([url], [])
  }

  if (host.includes('openlibrary.org')) {
    const work = /\/works\/(OL\d+[A-Za-z]?)/i.exec(path)
    if (work) return pack([url], [`openlibrary:${work[1].toUpperCase()}`])
    const isbn = /\/isbn\/([0-9Xx\-]+)/i.exec(path)
    if (isbn) {
      const digits = isbn[1].replace(/[\s\-]/g, '')
      return pack([url], [`isbn:${digits}`])
    }
    return pack([url], [])
  }

  if (host.includes('wikidata.org')) {
    const m = /\/wiki\/(Q\d+)/i.exec(path)
    return m ? pack([url], [`wikidata:${m[1]}`]) : pack([url], [])
  }

  return pack([url], [])
}

function expandTerm(raw: string): IdentifierExpanderQuery {
  const lower = raw.toLowerCase()

  if (/^(gutenberg|openlibrary|isbn|wikidata|wikipedia|overdrive):/i.test(raw)) {
    return pack([], [raw])
  }

  if (/^pg\d+$/i.test(raw)) {
    const id = lower.replace(/^pg/, '')
    return pack([], [`gutenberg:${id}`])
  }

  if (/^\d{1,7}$/.test(raw)) {
    return pack([], [`gutenberg:${raw}`])
  }

  if (/^OL\d+[A-Za-z]?$/i.test(raw)) {
    return pack([], [`openlibrary:${raw.toUpperCase()}`])
  }

  if (/^Q\d+$/i.test(raw)) {
    return pack([], [`wikidata:${raw.toUpperCase()}`])
  }

  const isbnDigits = raw.replace(/[\s\-]/g, '')
  if (/^978\d{10}$/.test(isbnDigits) || /^\d{9}[\dXx]$/.test(isbnDigits)) {
    return pack([], [`isbn:${isbnDigits}`])
  }

  // Wikipedia page slug or title (spaces or underscores, optional parens)
  if (/^[A-Za-z0-9].*[_\s(]/.test(raw) || /^[A-Za-z][\w()'!.\-]+$/.test(raw)) {
    const page = raw.trim().replace(/ /g, '_')
    return pack([], [`wikipedia:en:${page}`])
  }

  return pack([], [])
}

/** Expand a pasted identifier into `{ s?: [...], i?: [...] }` (keys omitted when empty). */
export function expandIdentifier(raw: string): IdentifierExpanderQuery {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return {}
  return isUrl(trimmed) ? expandUrl(trimmed) : expandTerm(trimmed)
}
