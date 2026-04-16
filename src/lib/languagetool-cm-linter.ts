import { linter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { languageToolCheck, type LanguageToolMatch } from '@/lib/languagetool-client'

/** Local LanguageTool is slow on cold JVM; keep payloads bounded (LT has ~20–30k limits anyway). */
const MAX_CHECK_CHARS = 28_000

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
 * Per-editor state (debounce / abort) lives in the closure so promises always settle and stale fetches are cancelled.
 */
export function languageToolLintExtension(language: string, debounceMs: number): Extension {
  let requestSeq = 0
  let inFlight: AbortController | null = null

  return linter((view) => {
    return new Promise<Diagnostic[]>((resolve) => {
      let settled = false
      const finish = (diags: Diagnostic[]) => {
        if (settled) return
        settled = true
        resolve(diags)
      }

      const text = view.state.doc.toString()
      if (text.length < 3) {
        finish([])
        return
      }

      const seq = ++requestSeq
      inFlight?.abort()
      inFlight = null

      window.setTimeout(() => {
        if (seq !== requestSeq) {
          finish([])
          return
        }

        const toSend = text.length > MAX_CHECK_CHARS ? text.slice(0, MAX_CHECK_CHARS) : text
        const ac = new AbortController()
        inFlight = ac

        void languageToolCheck(toSend, language, ac.signal)
          .then((res) => {
            if (seq !== requestSeq) {
              finish([])
              return
            }
            const docLen = view.state.doc.length
            const out: Diagnostic[] = []
            for (const m of res.matches ?? []) {
              const d = matchToDiagnostic(docLen, m)
              if (d) out.push(d)
            }
            finish(out)
          })
          .catch(() => {
            finish([])
          })
      }, debounceMs)
    })
  })
}
