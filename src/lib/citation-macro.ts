/** Matches {@link MarkdownArticle} / AsciiDoc citation token `[[citation::type::…]]`. */
export type CitationDisplayType =
  | 'end'
  | 'foot'
  | 'foot-end'
  | 'inline'
  | 'quote'
  | 'prompt-end'
  | 'prompt-inline'

export const CITATION_DISPLAY_TYPES: CitationDisplayType[] = [
  'inline',
  'quote',
  'end',
  'foot',
  'foot-end',
  'prompt-inline',
  'prompt-end'
]

export const PROMPT_CITATION_DISPLAY_TYPES: CitationDisplayType[] = ['prompt-inline', 'prompt-end']

export function defaultCitationDisplayType(
  citationKind: 'internal' | 'external' | 'hardcopy' | 'prompt'
): CitationDisplayType {
  return citationKind === 'prompt' ? 'prompt-inline' : 'inline'
}

export function citationDisplayTypesForKind(
  citationKind: 'internal' | 'external' | 'hardcopy' | 'prompt'
): CitationDisplayType[] {
  return citationKind === 'prompt' ? PROMPT_CITATION_DISPLAY_TYPES : CITATION_DISPLAY_TYPES.filter(
    (t) => !t.startsWith('prompt-')
  )
}

/** `[[citation::inline::nevent1…]]` — bech32 id without `nostr:` prefix. */
export function buildCitationWikiMacro(displayType: CitationDisplayType, bech32Id: string): string {
  let id = bech32Id.trim()
  if (id.toLowerCase().startsWith('nostr:')) id = id.slice(6)
  return `[[citation::${displayType}::${id}]]`
}
