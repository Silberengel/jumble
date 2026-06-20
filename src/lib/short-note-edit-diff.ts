export type TextDiffPart = { type: 'equal' | 'delete' | 'insert'; value: string }

/** Split into words and whitespace tokens so diff preserves spacing. */
export function tokenizeForDiff(text: string): string[] {
  if (!text) return []
  return text.match(/\s+|[^\s]+/g) ?? []
}

function appendPart(parts: TextDiffPart[], type: TextDiffPart['type'], value: string): void {
  if (!value) return
  const last = parts[parts.length - 1]
  if (last?.type === type) {
    last.value += value
  } else {
    parts.push({ type, value })
  }
}

/** LCS token diff — deletions before insertions at each change site. */
export function diffTextInline(oldText: string, newText: string): TextDiffPart[] {
  const a = tokenizeForDiff(oldText)
  const b = tokenizeForDiff(newText)
  const n = a.length
  const m = b.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const parts: TextDiffPart[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      appendPart(parts, 'equal', a[i])
      i++
      j++
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      appendPart(parts, 'insert', b[j])
      j++
    } else if (i < n) {
      appendPart(parts, 'delete', a[i])
      i++
    }
  }
  return parts
}

export function shortNoteEditHasVisibleDiff(oldText: string, newText: string): boolean {
  if (oldText === newText) return false
  return diffTextInline(oldText, newText).some((p) => p.type !== 'equal')
}
