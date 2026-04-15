import { ExtendedKind } from '@/constants'

/** Kinds whose body is AsciiDoc in Imwald (wiki article, publication content). */
export function isAsciidocMarkupKind(kind: number): boolean {
  return kind === ExtendedKind.WIKI_ARTICLE || kind === ExtendedKind.PUBLICATION_CONTENT
}
