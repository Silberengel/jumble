/**
 * `[[inner]]` is both a wiki link (Nostr / bookstr) and valid AsciiDoc (block anchor, biblio id, etc.).
 * When we rewrite every `[[…]]` to a wiki passthrough, AsciiDoc `[[id]]` anchors break; prefer `[#id]` before a block to avoid clashing with `[[wikilink]]`.
 *
 * Leave the original brackets for Asciidoctor when this looks like an AsciiDoc anchor, not a wiki slug.
 * @see https://docs.asciidoctor.org/asciidoc/latest/syntax/ids/
 */
export function shouldLeaveDoubleBracketForAsciidoctor(
  fullSource: string,
  matchIndex: number,
  matchLength: number,
  inner: string
): boolean {
  const t = inner.trim()
  if (!t) return false

  // Bibliographic / paired id (not wiki `target|display`)
  if (t.includes(',') && !t.includes('|')) return true

  const lineStart = fullSource.lastIndexOf('\n', matchIndex - 1) + 1
  const lineEndIdx = fullSource.indexOf('\n', matchIndex + matchLength)
  const lineEnd = lineEndIdx === -1 ? fullSource.length : lineEndIdx
  const lineTrimmed = fullSource.slice(lineStart, lineEnd).trim()
  const matchTrimmed = fullSource.slice(matchIndex, matchIndex + matchLength).trim()
  if (lineTrimmed !== matchTrimmed) return false

  const after = fullSource.slice(matchIndex + matchLength)
  if (!/^\s*\n(?:\s*\n)*={2,6}\s\S/.test(after)) return false

  // Lowercase slug + section ahead: legacy `[[id]]` block anchor (e.g. before == Intro); new content should use `[#id]`.
  // Uppercase wiki slugs like [[NIP-54]] still go through wiki passthrough.
  if (!/^[a-z][a-z0-9._-]*$/.test(t)) return false

  return true
}
