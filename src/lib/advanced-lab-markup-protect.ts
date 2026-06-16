/**
 * Ranges in the lab editor source that must not be grammar-checked or machine-translated.
 * Covers Advanced Event Lab toolbar constructs: headings, lists, quotes, tables, code fences,
 * math ($ / $$), Markdown links/images (structure only), task items, footnotes, inline code,
 * emphasis/strike delimiters, and AsciiDoc blocks, macros, stem, passthrough, xref.
 * Also: wiki `[[…]]` (incl. `citation::`), `wikilink:`, `nostr:…` / bare NIP-19 bech32 (`npub1`…, etc.), and `link:url[text]` macros.
 * Raw `http://` / `https://` URLs (so blossom-style hosts `https://npub1….band/…/file.gif` are not split for translation).
 * NIP-style custom/native emoji shortcodes `:shortcode:` (see {@link EMOJI_SHORT_CODE_REGEX}).
 * Markdown `#hashtag` tokens (Unicode letters/numbers/mark, `_`, `-`).
 */

import { EMOJI_SHORT_CODE_REGEX } from '@/lib/content-patterns'
import { translatePlainText } from '@/lib/translate-client'

export type AdvancedLabMarkupMode = 'markdown' | 'asciidoc'

export type TranslateAdvancedLabMarkupOptions = {
  /**
   * When true, translatable segments are sent in a single `translatePlainText` call per segment,
   * preserving embedded newlines. Default splits on newlines so LibreTranslate cannot drop a line;
   * coalesced Markdown blockquote runs use this so the model sees full quote context in one `q`.
   */
  preserveEmbeddedNewlinesInTranslatable?: boolean
}

function mergeSortedRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return []
  const s = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: [number, number][] = []
  let [cs, ce] = s[0]!
  for (let i = 1; i < s.length; i++) {
    const [a, b] = s[i]!
    if (a <= ce) ce = Math.max(ce, b)
    else {
      out.push([cs, ce])
      cs = a
      ce = b
    }
  }
  out.push([cs, ce])
  return out
}

function posInMerged(pos: number, merged: [number, number][]): boolean {
  return merged.some(([a, b]) => pos >= a && pos < b)
}

/** Walk logical lines; `lineStart` is index of first char, `raw` has no line ending. */
function forEachLine(
  text: string,
  cb: (raw: string, lineStart: number, lineIndex: number) => void
): void {
  const lines = text.split(/\r?\n/)
  let lineStart = 0
  for (let li = 0; li < lines.length; li++) {
    cb(lines[li]!, lineStart, li)
    lineStart += lines[li]!.length
    if (li < lines.length - 1) {
      if (text[lineStart] === '\r' && text[lineStart + 1] === '\n') lineStart += 2
      else lineStart += 1
    }
  }
}

/** Find closing `$` for inline math starting after opening `$` at index `open + 1`. */
function findClosingInlineDollar(text: string, open: number): number {
  let j = open + 1
  while (j < text.length) {
    const c = text[j]
    if (c === '\\' && j + 1 < text.length) {
      j += 2
      continue
    }
    if (c === '$') return j
    j++
  }
  return -1
}

function collectLatexRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const close = text.indexOf('$$', i + 2)
      if (close === -1) break
      ranges.push([i, close + 2])
      i = close + 2
      continue
    }
    if (text[i] === '$') {
      const close = findClosingInlineDollar(text, i)
      if (close < 0) {
        i++
        continue
      }
      ranges.push([i, close + 1])
      i = close + 1
      continue
    }
    i++
  }
  return ranges
}

function collectFencedCodeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const n = text.length
  let i = 0
  while (i < n) {
    if (!text.startsWith('```', i)) {
      i++
      continue
    }
    if (i > 0 && text[i - 1] !== '\n' && text[i - 1] !== '\r') {
      i++
      continue
    }
    const firstNl = text.indexOf('\n', i)
    const bodyStart = firstNl === -1 ? n : firstNl + 1
    let p = bodyStart
    let blockEnd = -1
    while (p <= n) {
      const nl = text.indexOf('\n', p)
      const lineEnd = nl === -1 ? n : nl
      const line = text.slice(p, lineEnd)
      if (/^[\t ]{0,3}```(?:\s|$)/.test(line)) {
        blockEnd = nl === -1 ? n : nl + 1
        break
      }
      if (nl === -1) break
      p = nl + 1
    }
    if (blockEnd < 0) {
      i = bodyStart
      continue
    }
    ranges.push([i, blockEnd])
    i = blockEnd
  }
  return ranges
}

/** GFM-style column alignment row: pipes, colons, dashes, spaces only, and at least one dash. */
function looksLikePipeTableSeparatorRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  if (!/^[\s|\-:]+$/.test(t)) return false
  if (!/-/.test(t)) return false
  return true
}

function collectPipeTableRanges(text: string, mergedBase: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split(/\r?\n/)
  const rowFlags = lines.map((rawLine) => {
    let pipeCount = 0
    for (let j = 0; j < rawLine.length; j++) {
      if (rawLine[j] === '|') pipeCount++
    }
    const isSep = looksLikePipeTableSeparatorRow(rawLine)
    return isSep || pipeCount >= 2
  })

  let lineStart = 0
  let prevWasTableRow = false
  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li]!
    const isTableRow = rowFlags[li]!

    if (li > 0 && prevWasTableRow && isTableRow) {
      let gapStart = lineStart - 1
      if (gapStart >= 1 && text[gapStart] === '\n' && text[gapStart - 1] === '\r') gapStart -= 1
      if (gapStart < lineStart) ranges.push([gapStart, lineStart])
    }

    if (isTableRow) {
      const isSep = looksLikePipeTableSeparatorRow(rawLine)
      if (isSep) {
        const a = lineStart
        const b = lineStart + rawLine.length
        if (a < b && !posInMerged(a, mergedBase)) ranges.push([a, b])
      } else {
        for (let j = 0; j < rawLine.length; j++) {
          if (rawLine[j] !== '|') continue
          const g = lineStart + j
          if (!posInMerged(g, mergedBase)) ranges.push([g, g + 1])
        }
      }
    }

    prevWasTableRow = isTableRow
    lineStart += rawLine.length
    if (li < lines.length - 1) {
      if (text[lineStart] === '\r' && text[lineStart + 1] === '\n') lineStart += 2
      else lineStart += 1
    }
  }
  return ranges
}

function findClosingParenMdUrl(text: string, openParen: number): number {
  let i = openParen
  let depth = 0
  let inStr: '"' | "'" | null = null
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      if (c === '\\' && i + 1 < text.length) {
        i += 2
        continue
      }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
}

/** Walk label inside `[...]` starting at `labelStart` (first char inside brackets). */
function findLabelEndBracket(text: string, labelStart: number): number {
  let j = labelStart
  while (j < text.length) {
    const c = text[j]
    if (c === '\\' && j + 1 < text.length) {
      j += 2
      continue
    }
    if (c === ']') return j
    j++
  }
  return -1
}

/**
 * Inside `[...](` … `)`, find optional CommonMark title after the destination.
 * Returns indices relative to `inner` (slice between `(` and closing `)`).
 */
function parseMdInlineLinkDestForTitle(inner: string): {
  /** Freeze [0, titleQuoteIdx) — destination + whitespace before title. */
  titleQuoteIdx: number
  /** Freeze [closeQuoteIdx, closeQuoteIdx + 1) — closing quote. */
  closeQuoteIdx: number
} | null {
  if (!inner) return null
  let hrefEnd = 0
  if (inner[0] === '<') {
    let j = 1
    while (j < inner.length) {
      if (inner[j] === '\\' && j + 1 < inner.length) {
        j += 2
        continue
      }
      if (inner[j] === '>') {
        hrefEnd = j + 1
        break
      }
      j++
    }
    if (hrefEnd === 0) hrefEnd = inner.length
  } else {
    const m = inner.match(/^\S+/)
    if (!m) return null
    hrefEnd = m[0].length
  }
  let p = hrefEnd
  while (p < inner.length && /\s/.test(inner[p]!)) p++
  if (p >= inner.length) return null
  const q = inner[p]
  if (q !== '"' && q !== "'") return null
  const bodyStart = p + 1
  let j = bodyStart
  while (j < inner.length) {
    if (inner[j] === '\\' && j + 1 < inner.length) {
      j += 2
      continue
    }
    if (inner[j] === q) return { titleQuoteIdx: p, closeQuoteIdx: j }
    j++
  }
  return null
}

/** Push frozen ranges for `](` … `)`; link title body (between quotes) stays translatable. */
function pushMarkdownLinkParenStructureRanges(
  ranges: [number, number][],
  text: string,
  lbEnd: number,
  parenEnd: number
): void {
  const innerStart = lbEnd + 2
  const closeParenIdx = parenEnd - 1
  ranges.push([lbEnd, innerStart])
  const inner = text.slice(innerStart, closeParenIdx)
  const titled = parseMdInlineLinkDestForTitle(inner)
  if (!titled) {
    ranges.push([innerStart, parenEnd])
    return
  }
  const { titleQuoteIdx, closeQuoteIdx } = titled
  ranges.push([innerStart, innerStart + titleQuoteIdx])
  ranges.push([innerStart + titleQuoteIdx, innerStart + titleQuoteIdx + 1])
  ranges.push([innerStart + closeQuoteIdx, innerStart + closeQuoteIdx + 1])
  ranges.push([closeParenIdx, parenEnd])
}

/** Markdown / CommonMark `link` and `image` — freeze brackets/URL/title quotes; label + title body translate. */
function collectMarkdownLinkImageStructureRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length - 1) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    const isImg = text.startsWith('![', i)
    const isLink = text[i] === '[' && text[i + 1] !== '^' && text[i + 1] !== '['
    if (!isImg && !isLink) {
      i++
      continue
    }
    const labelStart = isImg ? i + 2 : i + 1
    const lbEnd = findLabelEndBracket(text, labelStart)
    if (lbEnd < 0 || lbEnd + 1 >= text.length || text[lbEnd + 1] !== '(') {
      i++
      continue
    }
    const parenEnd = findClosingParenMdUrl(text, lbEnd + 1)
    if (parenEnd < 0) {
      i++
      continue
    }
    if (isImg) ranges.push([i, i + 2])
    else ranges.push([i, i + 1])
    pushMarkdownLinkParenStructureRanges(ranges, text, lbEnd, parenEnd)
    i = parenEnd
  }
  return ranges
}

/** `[^id]` reference (not definition line — handled by line prefix). */
function collectMarkdownFootnoteRefRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length - 2) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (text[i] !== '[' || text[i + 1] !== '^') {
      i++
      continue
    }
    const j = findLabelEndBracket(text, i + 2)
    if (j < 0 || j === i + 2) {
      i++
      continue
    }
    ranges.push([i, j + 1])
    i = j + 1
  }
  return ranges
}

/** Fenced code spans with run of backticks (CommonMark). */
function collectInlineCodeRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (text[i] !== '`') {
      i++
      continue
    }
    let n = 0
    let p = i
    while (p < text.length && text[p] === '`') {
      n++
      p++
    }
    let q = p
    let found = -1
    while (q < text.length) {
      if (text[q] === '`') {
        let m = 0
        let r = q
        while (r < text.length && text[r] === '`') {
          m++
          r++
        }
        if (m >= n) {
          found = r
          break
        }
        q = r
        continue
      }
      q++
    }
    if (found < 0) break
    ranges.push([i, found])
    i = found
  }
  return ranges
}

/** Freeze only `**` / `__` / `~~` delimiter pairs so inner text still translates (toolbar inline). */
function collectMarkdownDelimiterPairEdges(
  text: string,
  merged: [number, number][],
  token: string
): [number, number][] {
  const ranges: [number, number][] = []
  const tl = token.length
  if (tl < 2) return ranges
  let i = 0
  while (i <= text.length - tl * 2) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (!text.startsWith(token, i)) {
      i++
      continue
    }
    let j = i + tl
    while (j <= text.length - tl) {
      if (posInMerged(j, merged)) {
        j++
        continue
      }
      if (text.startsWith(token, j)) {
        ranges.push([i, i + tl], [j, j + tl])
        i = j + tl
        break
      }
      j++
    }
    if (j > text.length - tl) i++
  }
  return ranges
}

function matchAsciiDocLinePrefix(rawLine: string): RegExpMatchArray | null {
  const patterns: RegExp[] = [
    /^[\t ]{0,3}\/\/[^\n]*$/,
    /^[\t ]{0,3}(?:-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,})\s*$/,
    /^[\t ]{0,3}\|={3,}\s*$/,
    /^[\t ]{0,3}(?:---|\*\*\*|___|''')\s*$/,
    /^[\t ]{0,3}--\s*$/,
    /^[\t ]{0,3}\+\s*$/,
    /^[\t ]{0,3}=+\s+/,
    /^[\t ]{0,3}(?:ifdef|ifndef|ifeval|endif)::[^\n]*$/,
    /^[\t ]{0,3}(?:include|image|video|audio|xref|link|mailto|pass|kbd|btn|menu|anchor|set|footnote)::[^\n]*$/,
    /^[\t ]{0,3}\[\[[^\]]+\]\]\s*/,
    /^[\t ]{0,3}(\[[^\]\n]+\]\s*)$/,
    /^[\t ]{0,3}(:[!]?[A-Za-z0-9_][\w-]*:)\s*/,
    /^[\t ]{0,3}(?!https?:\/\/)(.+?::\s+)/,
    /^[\t ]{0,3}\*{1,9}\s+/,
    /^[\t ]{0,3}-\s+/,
    /^[\t ]{0,3}\.{1,9}\s+/
  ]
  for (const re of patterns) {
    const m = rawLine.match(re)
    if (m) return m
  }
  return null
}

function collectLinePrefixRanges(
  text: string,
  mode: AdvancedLabMarkupMode,
  mergedBase: [number, number][]
): [number, number][] {
  const ranges: [number, number][] = []
  forEachLine(text, (rawLine, lineStart) => {
    if (posInMerged(lineStart, mergedBase)) return
    let m: RegExpMatchArray | null = null
    if (mode === 'markdown') {
      m =
        rawLine.match(/^[\t ]{0,3}(#{1,6}\s+)/) ||
        rawLine.match(/^[\t ]{0,3}(?:[-*+]\s+\[[ xX]\]\s+)/) ||
        rawLine.match(/^[\t ]{0,3}(?:[-*+]\s+)/) ||
        rawLine.match(/^[\t ]{0,3}(?:\d{1,9}\.\s+)/) ||
        rawLine.match(/^[\t ]{0,3}(>\s?)/) ||
        rawLine.match(/^[\t ]{0,3}(\[\^[^\]\n]+\]:)\s*/) ||
        rawLine.match(/^[\t ]{0,3}(?:[-*]{3,}|_{3,})\s*$/) ||
        rawLine.match(/^[\t ]{0,3}=+\s*$/) ||
        rawLine.match(/^[\t ]{0,3}(?:`{3,}\s*)\S.*$/)
    } else {
      m = matchAsciiDocLinePrefix(rawLine)
    }
    if (m && m[0].length > 0) ranges.push([lineStart, lineStart + m[0].length])
  })
  return ranges
}

const ADOC_FENCE_LINE = /^[\t ]{0,3}(-{4,}|={4,}|\*{4,}|_{4,}|\.{4,}|\+{4,}|--)\s*$/

function lineMatchFence(raw: string): string | null {
  const t = raw.replace(/\r$/, '')
  const m = t.match(ADOC_FENCE_LINE)
  return m ? m[1]! : null
}

/** `[source,...]` or `[NOTE]` / `[TIP]` / … / `[stem]` / `[listing]` / `[example]` (toolbar blocks). */
function isAdocBlockMetaLine(raw: string): boolean {
  const t = raw.trim()
  if (!/^\[[^\]]+\]$/.test(t)) return false
  return /^\[\s*(source|NOTE|TIP|WARNING|IMPORTANT|CAUTION|stem|listing|example|discrete)/i.test(t)
}

function collectAsciiDocStructuredBlocks(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split(/\r?\n/)
  let offset = 0
  const lineStarts: number[] = []
  for (let li = 0; li < lines.length; li++) {
    lineStarts.push(offset)
    offset += lines[li]!.length
    if (li < lines.length - 1) {
      if (text[offset] === '\r' && text[offset + 1] === '\n') offset += 2
      else offset += 1
    }
  }

  let li = 0
  while (li < lines.length) {
    const raw = lines[li]!
    const ls = lineStarts[li]!
    if (!posInMerged(ls, merged)) {
      const meta = isAdocBlockMetaLine(raw)
      let openFenceLine = li
      let fenceToken: string | null = null
      if (meta) {
        let j = li + 1
        while (j < lines.length && /^\s*$/.test(lines[j]!)) j++
        if (j < lines.length) {
          const f = lineMatchFence(lines[j]!)
          if (f && (f === '----' || f === '====' || f === '++++')) {
            openFenceLine = j
            fenceToken = f
          }
        }
      } else {
        const f = lineMatchFence(raw)
        if (
          f &&
          (f === '----' ||
            f === '====' ||
            f === '++++' ||
            f === '****' ||
            f === '____' ||
            f === '....' ||
            f === '--')
        ) {
          openFenceLine = li
          fenceToken = f
        }
      }

      if (fenceToken) {
        let k = openFenceLine + 1
        while (k < lines.length) {
          if (lineMatchFence(lines[k]!) === fenceToken) {
            const endLineIdx = k
            let endOff = lineStarts[endLineIdx]! + lines[endLineIdx]!.length
            if (endLineIdx < lines.length - 1) {
              if (text[endOff] === '\r' && text[endOff + 1] === '\n') endOff += 2
              else endOff += 1
            }
            const startOff = meta ? ls : lineStarts[openFenceLine]!
            ranges.push([startOff, endOff])
            li = endLineIdx
            break
          }
          k++
        }
      }
    }
    li++
  }
  return ranges
}

function bracketDepthClose(text: string, from: number): number {
  let d = 0
  for (let p = from; p < text.length; p++) {
    const c = text[p]
    if (c === '\\' && p + 1 < text.length) {
      p++
      continue
    }
    if (c === '[') d++
    else if (c === ']') {
      d--
      if (d === 0) return p + 1
    }
  }
  return -1
}

function isAsciiDocMacroBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]!
  return !/[a-zA-Z0-9_]/.test(prev)
}

/** AsciiDoc `stem:[…]`, `latexmath:[…]`, `footnote:[…]`, `kbd:[]`, `btn:[]`, `image::…[]`, `video::…`, `audio::…` (`link:` / `menu:` handled in {@link collectLinkMenuColonMacros}). */
function collectAsciiDocInlineMacroRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const needles = [
    'stem:[',
    'latexmath:[',
    'footnote:[',
    'kbd:[',
    'btn:[',
    'image::',
    'video::',
    'audio::'
  ] as const

  let i = 0
  while (i < text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    let hit: (typeof needles)[number] | null = null
    for (const n of needles) {
      if (text.startsWith(n, i) && isAsciiDocMacroBoundary(text, i)) {
        hit = n
        break
      }
    }
    if (!hit) {
      i++
      continue
    }
    if (hit === 'image::' || hit === 'video::' || hit === 'audio::') {
      const ob = text.indexOf('[', i + hit.length)
      if (ob < 0) {
        const nl = text.indexOf('\n', i)
        ranges.push([i, nl === -1 ? text.length : nl + 1])
        i++
        continue
      }
      const end = bracketDepthClose(text, ob)
      if (end < 0) {
        i++
        continue
      }
      ranges.push([i, end])
      i = end
      continue
    }
    const openBracket = i + hit.length - 1
    if (text[openBracket] !== '[') {
      i++
      continue
    }
    const end = bracketDepthClose(text, openBracket)
    if (end < 0) {
      i++
      continue
    }
    ranges.push([i, end])
    i = end
  }
  return ranges
}

/** `+++passthrough+++` (toolbar). */
function collectAsciiDocTriplePlusPassthrough(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i + 3 <= text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (!text.startsWith('+++', i)) {
      i++
      continue
    }
    const close = text.indexOf('+++', i + 3)
    if (close < 0) break
    ranges.push([i, close + 3])
    i = close + 3
  }
  return ranges
}

/** `[[page]]`, `[[page|label]]`, `[[citation::…]]`, AsciiDoc `[[id]]`. */
function collectWikiDoubleBracketRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i + 3 <= text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (!text.startsWith('[[', i)) {
      i++
      continue
    }
    const close = text.indexOf(']]', i + 2)
    if (close < 0) break
    ranges.push([i, close + 2])
    i = close + 2
  }
  return ranges
}

/** `wikilink:dtag[label]` (post-processed wiki). */
function collectWikilinkMarkerRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const re = /\bWIKILINK:([^\s[\n]+)(?:\[[^\]]*\])?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const s = m.index
    if (!posInMerged(s, merged)) ranges.push([s, s + m[0].length])
  }
  return ranges
}

/**
 * Standalone `http://` / `https://` URLs (not only inside Markdown `[]()`).
 * Without this, a host like `npub1….blossom.band/…/x.gif` is split: bare-npub protection covers only the
 * first 63 chars after `npub1`, leaving `.gif` and the path in the translatable stream.
 */
function collectRawHttpUrlRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length - 7) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    const head = text.slice(i, i + 8).toLowerCase()
    const isHttps = head.startsWith('https://')
    const isHttp = !isHttps && head.startsWith('http://')
    if (!isHttps && !isHttp) {
      i++
      continue
    }
    const start = i
    i += isHttps ? 8 : 7
    let end = i
    while (end < text.length) {
      const c = text[end]!
      if (/\s/.test(c)) break
      if (c === '<' || c === '>' || c === '"' || c === "'" || c === '`') break
      if (c === ')' || c === ']' || c === '}') break
      end++
    }
    if (end > start) ranges.push([start, end])
    i = end
  }
  return ranges
}

/** AsciiDoc / Markdown `link:url[text]` and `menu:…[…]` (toolbar + jumble). */
function collectLinkMenuColonMacros(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const prefixes = ['link:', 'menu:'] as const
  let i = 0
  while (i < text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    let hit: (typeof prefixes)[number] | null = null
    for (const p of prefixes) {
      if (text.startsWith(p, i) && isAsciiDocMacroBoundary(text, i)) {
        hit = p
        break
      }
    }
    if (!hit) {
      i++
      continue
    }
    const ob = text.indexOf('[', i + hit.length)
    if (ob < 0) {
      i++
      continue
    }
    const end = bracketDepthClose(text, ob)
    if (end < 0) {
      i++
      continue
    }
    ranges.push([i, end])
    i = end
  }
  return ranges
}

const B32 = '[ac-hj-np-z02-9]'
const RE_NOSTR_PREFIX = new RegExp(
  `^nostr:(npub1${B32}{58}|nprofile1${B32}{20,}|note1${B32}{20,}|nevent1${B32}{20,}|naddr1${B32}{20,}|nrelay1${B32}{20,})(?!${B32})`,
  'i'
)
const RE_NPUB_BARE = new RegExp(`^npub1${B32}{58}(?!${B32})`, 'i')
const RE_BARE_OTHER = new RegExp(
  `^((?:nprofile|note|nevent|naddr|nrelay)1${B32}{20,})(?!${B32})`,
  'i'
)

/** `nostr:npub1…` / `nostr:nevent1…` and bare NIP-19 bech32 entities. */
function collectNostrAndBech32Ranges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (i > 0 && /[a-zA-Z0-9_]/.test(text[i - 1]!)) {
      i++
      continue
    }
    const slice = text.slice(i)
    const prefixed = slice.match(RE_NOSTR_PREFIX)
    if (prefixed) {
      ranges.push([i, i + prefixed[0].length])
      i += prefixed[0].length
      continue
    }
    const npub = slice.match(RE_NPUB_BARE)
    if (npub) {
      ranges.push([i, i + npub[0].length])
      i += npub[0].length
      continue
    }
    const other = slice.match(RE_BARE_OTHER)
    if (other) {
      ranges.push([i, i + other[0].length])
      i += other[0].length
      continue
    }
    i++
  }
  return ranges
}

/** AsciiDoc `<<id,label>>` / `<<id>>`. */
function collectAsciiDocXrefRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0
  while (i < text.length - 3) {
    if (posInMerged(i, merged)) {
      i++
      continue
    }
    if (!text.startsWith('<<', i)) {
      i++
      continue
    }
    const close = text.indexOf('>>', i + 2)
    if (close < 0) break
    ranges.push([i, close + 2])
    i = close + 2
  }
  return ranges
}

/** `#tag` / `#plebchain` spans; skipped when already inside a frozen range (e.g. URL). */
function collectMarkdownHashtagRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const re = /#[\p{L}\p{N}\p{M}_-]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    if (posInMerged(start, merged)) continue
    ranges.push([start, start + m[0].length])
  }
  return ranges
}

/** `:shortcode:` spans (custom / native emoji); skipped when already inside code, links, etc. */
function collectEmojiShortcodeRanges(text: string, merged: [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const re = new RegExp(EMOJI_SHORT_CODE_REGEX.source, 'gu')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    if (posInMerged(start, merged)) continue
    ranges.push([start, start + m[0].length])
  }
  return ranges
}

/**
 * Merged half-open ranges `[start,end)` in `text` that must be left unchanged for LT / translate.
 */
export function getMarkupProtectRanges(text: string, mode: AdvancedLabMarkupMode): [number, number][] {
  const latex = collectLatexRanges(text)
  const fenced = collectFencedCodeRanges(text)
  let merged = mergeSortedRanges([...latex, ...fenced])

  const wiki = collectWikiDoubleBracketRanges(text, merged)
  merged = mergeSortedRanges([...merged, ...wiki])
  const wikilinkM = collectWikilinkMarkerRanges(text, merged)
  merged = mergeSortedRanges([...merged, ...wikilinkM])
  const linkMenu = collectLinkMenuColonMacros(text, merged)
  merged = mergeSortedRanges([...merged, ...linkMenu])
  const rawHttpUrls = collectRawHttpUrlRanges(text, merged)
  merged = mergeSortedRanges([...merged, ...rawHttpUrls])
  const nostrBech = collectNostrAndBech32Ranges(text, merged)
  merged = mergeSortedRanges([...merged, ...nostrBech])
  const triplePlus = collectAsciiDocTriplePlusPassthrough(text, merged)
  merged = mergeSortedRanges([...merged, ...triplePlus])

  if (mode === 'markdown') {
    const code = collectInlineCodeRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...code])
    const links = collectMarkdownLinkImageStructureRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...links])
    const fn = collectMarkdownFootnoteRefRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...fn])
    const strike = collectMarkdownDelimiterPairEdges(text, merged, '~~')
    const bold = collectMarkdownDelimiterPairEdges(text, mergeSortedRanges([...merged, ...strike]), '**')
    const boldU = collectMarkdownDelimiterPairEdges(text, mergeSortedRanges([...merged, ...bold]), '__')
    merged = mergeSortedRanges([...merged, ...strike, ...bold, ...boldU])
    const hashtags = collectMarkdownHashtagRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...hashtags])
  } else {
    const adocBlocks = collectAsciiDocStructuredBlocks(text, merged)
    merged = mergeSortedRanges([...merged, ...adocBlocks])
    const code = collectInlineCodeRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...code])
    const macros = collectAsciiDocInlineMacroRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...macros])
    const xref = collectAsciiDocXrefRanges(text, merged)
    merged = mergeSortedRanges([...merged, ...xref])
  }

  const prefixes = collectLinePrefixRanges(text, mode, merged)
  merged = mergeSortedRanges([...merged, ...prefixes])
  const pipes = collectPipeTableRanges(text, merged)
  merged = mergeSortedRanges([...merged, ...pipes])
  const emoji = collectEmojiShortcodeRanges(text, merged)
  return mergeSortedRanges([...merged, ...emoji])
}

export function rangeIntersectsMerged(pos: number, len: number, merged: [number, number][]): boolean {
  const a = pos
  const b = pos + len
  for (const [rs, re] of merged) {
    if (a < re && b > rs) return true
  }
  return false
}

type Seg = { translatable: boolean; start: number; end: number }

function buildSegments(text: string, merged: [number, number][]): Seg[] {
  const segs: Seg[] = []
  let cursor = 0
  for (const [fs, fe] of merged) {
    if (cursor < fs) segs.push({ translatable: true, start: cursor, end: fs })
    if (fs < fe) segs.push({ translatable: false, start: fs, end: fe })
    cursor = Math.max(cursor, fe)
  }
  if (cursor < text.length) segs.push({ translatable: true, start: cursor, end: text.length })
  return segs
}

/**
 * LibreTranslate often drops or normalizes newlines in `q`, which breaks Markdown/AsciiDoc.
 * Split on line breaks (keep CRLF/LF as literal pieces) and only send non-whitespace text lines
 * to the API; preserve newline runs and whitespace-only spans unchanged.
 */
async function translatePreservingLineBreaks(
  text: string,
  targetLang: string,
  sourceLang: string,
  opts?: TranslateAdvancedLabMarkupOptions
): Promise<string> {
  if (opts?.preserveEmbeddedNewlinesInTranslatable && text.trim() !== '') {
    return translatePlainText(text, targetLang, sourceLang)
  }
  const pieces = text.split(/(\r?\n+)/)
  const out: string[] = []
  for (const p of pieces) {
    if (p === '') continue
    if (/^\r?\n+$/.test(p)) {
      out.push(p)
      continue
    }
    if (/^\s+$/.test(p)) {
      out.push(p)
      continue
    }
    out.push(await translatePlainText(p, targetLang, sourceLang))
  }
  return out.join('')
}

export async function translateAdvancedLabMarkup(
  text: string,
  targetLang: string,
  sourceLang: string,
  mode: AdvancedLabMarkupMode,
  options?: TranslateAdvancedLabMarkupOptions
): Promise<string> {
  const merged = getMarkupProtectRanges(text, mode)
  if (merged.length === 0) {
    return translatePreservingLineBreaks(text, targetLang, sourceLang, options)
  }
  const segs = buildSegments(text, merged)
  const parts = await Promise.all(
    segs.map(async (s) => {
      const chunk = text.slice(s.start, s.end)
      if (!s.translatable) return chunk
      if (!chunk) return chunk
      return translatePreservingLineBreaks(chunk, targetLang, sourceLang, options)
    })
  )
  return parts.join('')
}
