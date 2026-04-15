import { linter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { languageToolCheck, type LanguageToolMatch } from '@/lib/languagetool-client'

function matchToDiagnostic(docLen: number, m: LanguageToolMatch): Diagnostic | null {
  const from = Math.max(0, Math.min(m.offset, docLen))
  const to = Math.max(from, Math.min(m.offset + m.length, docLen))
  if (to <= from) return null
  const fix = m.replacements?.[0]?.value
  return {
    from,
    to,
    severity: 'info',
    message: m.message + (m.rule?.id ? ` (${m.rule.id})` : ''),
    actions: fix
      ? [
          {
            name: 'Apply',
            apply(view) {
              view.dispatch({ changes: { from, to, insert: fix } })
            }
          }
        ]
      : undefined
  }
}

/**
 * Async grammar/style lint for CodeMirror using LanguageTool `/v2/check`.
 */
export function languageToolLintExtension(
  language: string,
  debounceMs: number
): Extension {
  return linter((view) => {
    return new Promise<Diagnostic[]>((resolve) => {
      const text = view.state.doc.toString()
      if (text.length < 3) {
        resolve([])
        return
      }
      const seq = ++requestSeq
      window.setTimeout(() => {
        if (seq !== requestSeq) return
        void languageToolCheck(text, language)
          .then((res) => {
            if (seq !== requestSeq) return
            const docLen = view.state.doc.length
            const out: Diagnostic[] = []
            for (const m of res.matches ?? []) {
              const d = matchToDiagnostic(docLen, m)
              if (d) out.push(d)
            }
            resolve(out)
          })
          .catch(() => resolve([]))
      }, debounceMs)
    })
  })
}

let requestSeq = 0
