import { kinds } from 'nostr-tools'

/** Kinds edited with TipTap + format toolbar in edit/clone (markdown body). */
export function isRichMarkdownComposerKind(kind: number): boolean {
  return kind === kinds.ShortTextNote || kind === kinds.LongFormArticle
}
