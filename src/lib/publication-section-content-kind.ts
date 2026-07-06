import { ExtendedKind } from '@/constants'

/** Kinds rendered with the AsciiDoc pipeline inside publication section trees. */
export const ASCIIDOC_PUBLICATION_SECTION_KINDS = new Set<number>([
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE
])

export function isAsciidocPublicationSectionKind(kind: number): boolean {
  return ASCIIDOC_PUBLICATION_SECTION_KINDS.has(kind)
}
