import { linter, type Diagnostic } from '@codemirror/lint'
import { Annotation, EditorSelection, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  getMarkupProtectRanges,
  rangeIntersectsMerged,
  type AdvancedLabMarkupMode
} from '@/lib/advanced-lab-markup-protect'
import { languageToolCheck, type LanguageToolMatch } from '@/lib/languagetool-client'

/** Local LanguageTool is slow on cold JVM; keep payloads bounded (LT has ~20–30k limits anyway). */
const MAX_CHECK_CHARS = 28_000

/**
 * Attach to a transaction so {@link languageToolLintExtension}'s `needsRefresh` schedules a new
 * lint pass (e.g. grammar language changed). `forceLinting()` is a no-op once the last run finished.
 */
export const advancedLabGrammarLangRerun = Annotation.define<boolean>()

/** Request an immediate grammar re-check (after language change, etc.). */
export function requestAdvancedLabGrammarLint(view: EditorView): void {
  view.dispatch({ annotations: advancedLabGrammarLangRerun.of(true) })
}

function matchToDiagnostic(docLen: number, m: LanguageToolMatch): Diagnostic | null {
  const from = Math.max(0, Math.min(m.offset, docLen))
  const to = Math.max(from, Math.min(m.offset + m.length, docLen))
  if (to <= from) return null
  const fix = m.replacements?.[0]?.value
  const message = m.message + (m.rule?.id ? ` (${m.rule.id})` : '')

  if (!fix) {
    return { from, to, severity: 'info', message }
  }

  /**
   * Do not use {@link Diagnostic.actions} for Apply: CodeMirror resolves actions via
   * `findDiagnostic(..., diagnostic)` by **object identity**. Async LT refreshes replace
   * diagnostics with new objects, so the tooltip's stale reference never matches and Apply
   * never runs. A custom control in `renderMessage` uses stable closure `from`/`to`/`fix`.
   */
  return {
    from,
    to,
    severity: 'info',
    message,
    renderMessage(view: EditorView) {
      const wrap = document.createElement('span')
      wrap.style.display = 'inline-flex'
      wrap.style.alignItems = 'baseline'
      wrap.style.gap = '0.4em'

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cm-diagnosticAction'
      btn.textContent = 'Apply'
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const len = view.state.doc.length
        const f = Math.max(0, Math.min(from, len))
        const t = Math.max(f, Math.min(to, len))
        view.dispatch({
          changes: { from: f, to: t, insert: fix },
          selection: EditorSelection.cursor(f + fix.length)
        })
        view.focus()
      })
      wrap.appendChild(btn)

      const text = document.createElement('span')
      text.textContent = message
      wrap.appendChild(text)

      return wrap
    }
  }
}

/**
 * Async grammar/style lint for CodeMirror using LanguageTool `/v2/check`.
 * Per-editor state (debounce / abort) lives in the closure so promises always settle and stale fetches are cancelled.
 * `getLanguage` is read on each lint pass so the UI can change language without remounting the editor.
 * `getMarkupMode` selects which line-prefix syntax is treated as non-checkable markup.
 */
export function languageToolLintExtension(
  getLanguage: () => string,
  debounceMs: number,
  getMarkupMode: () => AdvancedLabMarkupMode
): Extension {
  let requestSeq = 0
  let inFlight: AbortController | null = null

  return linter(
    (view) => {
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

        const toSend = text.length > MAX_CHECK_CHARS ? text.slice(0, MAX_CHECK_CHARS) : text
        const ac = new AbortController()
        inFlight = ac

        const protectMerged = getMarkupProtectRanges(toSend, getMarkupMode())

        void languageToolCheck(toSend, getLanguage(), ac.signal)
          .then((res) => {
            if (seq !== requestSeq) {
              finish([])
              return
            }
            const docLen = view.state.doc.length
            const out: Diagnostic[] = []
            for (const m of res.matches ?? []) {
              if (rangeIntersectsMerged(m.offset, m.length, protectMerged)) continue
              const d = matchToDiagnostic(docLen, m)
              if (d) out.push(d)
            }
            finish(out)
          })
          .catch(() => {
            finish([])
          })
      })
    },
    {
      delay: debounceMs,
      needsRefresh: (update) =>
        update.transactions.some((tr) => tr.annotation(advancedLabGrammarLangRerun) === true)
    }
  )
}
