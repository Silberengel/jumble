import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'

export function labSyncSliceFromView(
  view: EditorView,
  sliceRef: { current: AdvancedEventLabSlice | null }
) {
  const s = sliceRef.current
  if (s) s.content = view.state.doc.toString()
}

export function labInsertSnippet(
  view: EditorView,
  sliceRef: { current: AdvancedEventLabSlice | null },
  before: string,
  placeholder: string,
  after: string
) {
  const sel = view.state.selection.main
  const insert = before + placeholder + after
  const innerFrom = sel.from + before.length
  const innerTo = innerFrom + placeholder.length
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.range(innerFrom, innerTo)
  })
  view.focus()
  labSyncSliceFromView(view, sliceRef)
}

export function labInsertRaw(
  view: EditorView,
  sliceRef: { current: AdvancedEventLabSlice | null },
  text: string
) {
  const sel = view.state.selection.main
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: EditorSelection.cursor(sel.from + text.length)
  })
  view.focus()
  labSyncSliceFromView(view, sliceRef)
}

/** Like {@link labInsertRaw}, but skips a leading newline when the selection starts at document position 0 (avoids an empty first line). */
export function labInsertRawWithOptionalBlockLeadNl(
  view: EditorView,
  sliceRef: { current: AdvancedEventLabSlice | null },
  body: string
) {
  const sel = view.state.selection.main
  const needsLeadNl = sel.from > 0
  const insert = needsLeadNl ? `\n${body}` : body
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.cursor(sel.from + insert.length)
  })
  view.focus()
  labSyncSliceFromView(view, sliceRef)
}

/** If there is a selection, wrap it; otherwise insert snippet with placeholder between delimiters. */
export function labWrapOrSnippet(
  view: EditorView,
  sliceRef: { current: AdvancedEventLabSlice | null },
  wrap: string,
  placeholder: string
) {
  const sel = view.state.selection.main
  const selected = view.state.sliceDoc(sel.from, sel.to)
  if (selected.length > 0) {
    const insert = `${wrap}${selected}${wrap}`
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: EditorSelection.cursor(sel.from + insert.length)
    })
    view.focus()
    labSyncSliceFromView(view, sliceRef)
  } else {
    labInsertSnippet(view, sliceRef, wrap, placeholder, wrap)
  }
}
