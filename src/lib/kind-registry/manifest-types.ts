/** Restricted selector into an event — no expressions, just where to read. */
export type Source = `tag:${string}` | `imeta:${string}` | 'content'

/** Closed palette of trusted formatters a manifest may name. */
export type Format = 'text' | 'tokenized' | 'markdown' | 'image' | 'url' | 'datetime' | 'ref'

export type Field = { label: string; format: Format } & ({ source: Source } | { template: string })

export type Manifest = {
  kinds: number[]
  title?: Source
  cover?: Source
  fields?: Field[]
  body?: { source: Source; format: 'tokenized' | 'text' | 'markdown' }
}
