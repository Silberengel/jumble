/**
 * Protect AsciiDoc verbatim regions (source/listing blocks, delimited blocks) from
 * wiki-link / markdown preprocessing that must not run inside fenced content.
 */

const ADOC_FENCE_LINE = /^[\t ]{0,3}(-{4,}|={4,}|\*{4,}|_{4,}|\.{4,}|\+{4,}|--)\s*$/

const VERBATIM_PLACEHOLDER_PREFIX = '\uE000JUMBLE_VERBATIM_'
const VERBATIM_PLACEHOLDER_SUFFIX = '\uE001'

function lineMatchFence(raw: string): string | null {
  const t = raw.replace(/\r$/, '')
  const m = t.match(ADOC_FENCE_LINE)
  return m ? m[1]! : null
}

function isAdocBlockMetaLine(raw: string): boolean {
  const t = raw.trim()
  if (!/^\[[^\]]+\]$/.test(t)) return false
  return /^\[\s*(source|NOTE|TIP|WARNING|IMPORTANT|CAUTION|stem|listing|example|discrete)/i.test(
    t
  )
}

/** Collect byte ranges of AsciiDoc delimited blocks that must stay verbatim. */
export function collectAsciiDocVerbatimRanges(text: string): Array<[number, number]> {
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
    li++
  }

  return mergeRanges(ranges)
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]!
    const cur = sorted[i]!
    if (cur[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], cur[1])
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function verbatimPlaceholder(index: number): string {
  return `${VERBATIM_PLACEHOLDER_PREFIX}${index}${VERBATIM_PLACEHOLDER_SUFFIX}`
}

export function protectAsciiDocVerbatimRegions(content: string): {
  text: string
  blocks: readonly string[]
} {
  const ranges = collectAsciiDocVerbatimRanges(content)
  if (ranges.length === 0) return { text: content, blocks: [] }

  const blocks: string[] = new Array(ranges.length)
  let text = content
  // Replace from end → start so earlier indices stay valid; placeholder index matches range order.
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i]!
    blocks[i] = content.slice(start, end)
    text = text.slice(0, start) + verbatimPlaceholder(i) + text.slice(end)
  }
  return { text, blocks }
}

export function restoreAsciiDocVerbatimRegions(
  content: string,
  blocks: readonly string[]
): string {
  let text = content
  for (let i = 0; i < blocks.length; i++) {
    text = text.replace(verbatimPlaceholder(i), blocks[i]!)
  }
  return text
}

/** True when the note body is already AsciiDoc (skip markdown → AsciiDoc conversion). */
export function looksLikeNativeAsciidoc(content: string): boolean {
  const trimmed = content.trimStart()
  if (/^=+ \S/.test(trimmed)) return true
  if (/^==+ \S/m.test(content)) return true
  if (/\[source[^\]]*\]\s*\n\s*----/m.test(content)) return true
  if (/^\[listing\]/m.test(content)) return true
  return false
}
