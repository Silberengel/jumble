import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'

export type LabInsertAnchor = { from: number; to: number }

let pendingInsertAnchor: LabInsertAnchor | null = null

/** Run insert helpers with an explicit selection (toolbar menus steal focus on mobile). */
export function labWithInsertAnchor(anchor: LabInsertAnchor, fn: () => void) {
  pendingInsertAnchor = anchor
  try {
    fn()
  } finally {
    pendingInsertAnchor = null
  }
}

function mainSelection(view: EditorView, anchor?: LabInsertAnchor | null): LabInsertAnchor {
  if (anchor) return anchor
  if (pendingInsertAnchor) return pendingInsertAnchor
  const sel = view.state.selection.main
  return { from: sel.from, to: sel.to }
}

/** Restore a saved range before insert (toolbar menus steal focus on mobile). */
export function labRestoreSelection(view: EditorView, anchor: LabInsertAnchor) {
  const sel = view.state.selection.main
  if (sel.from === anchor.from && sel.to === anchor.to) return
  view.dispatch({ selection: EditorSelection.range(anchor.from, anchor.to) })
}

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
  after: string,
  anchor?: LabInsertAnchor | null
) {
  const sel = mainSelection(view, anchor)
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
  text: string,
  anchor?: LabInsertAnchor | null
) {
  const sel = mainSelection(view, anchor)
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
  body: string,
  anchor?: LabInsertAnchor | null
) {
  const sel = mainSelection(view, anchor)
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
  placeholder: string,
  anchor?: LabInsertAnchor | null
) {
  const sel = mainSelection(view, anchor)
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
    labInsertSnippet(view, sliceRef, wrap, placeholder, wrap, sel)
  }
}
