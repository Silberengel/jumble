import {
  MENTION_NPUB_DROPDOWN_LIMIT,
  searchNpubsForMention,
  type PickerSearchMode
} from '@/services/mention-event-search.service'
import postEditor from '@/services/post-editor.service'
import type { Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import MentionList, { MentionListHandle, MentionListProps, type MentionListItem } from './MentionList'
import { NEVENT_NADDR_PICKER_ID } from './constants'
import { createSuggestionPopup } from '../suggestion-popup'

export type { PickerSearchMode }

const MENTION_EXTENSION_NAME = 'mention'
const MENTION_CHAR = '@'

export const OPEN_NEVENT_PICKER_EVENT = 'open-nevent-picker'

let currentComponent: ReactRenderer<MentionListHandle, MentionListProps> | undefined
let currentQuery = ''
let mentionSearchGeneration = 0

const MENTION_QUERY_CHAR = /[\w.-]/

/** Length of @query (including @) within `text` starting at index 0. */
export function mentionQueryLengthInText(text: string, mentionChar = MENTION_CHAR): number {
  if (text.startsWith(mentionChar)) {
    let i = mentionChar.length
    while (i < text.length && MENTION_QUERY_CHAR.test(text[i]!)) i++
    return i
  }
  let i = 0
  while (i < text.length && MENTION_QUERY_CHAR.test(text[i]!)) i++
  return i
}

/**
 * Extend range.to through the full @handle typed in the document.
 * TipTap's range.to is often stale (especially on mouse pick); scanning the doc text avoids leaving a trailing letter.
 */
export function extendMentionRangeToEndOfWord(editor: Editor, range: { from: number; to: number }): number {
  const { doc, selection } = editor.state
  const scanEnd = Math.min(doc.content.size, range.from + 300)
  const prefix = doc.textBetween(range.from, scanEnd, '', '')

  let end = range.to

  const queryLen = mentionQueryLengthInText(prefix)
  if (queryLen > 0) {
    end = Math.max(end, range.from + queryLen)
  } else {
    let pos = range.to
    while (pos < scanEnd) {
      const ch = doc.textBetween(pos, pos + 1, '', '')
      if (!ch || !MENTION_QUERY_CHAR.test(ch)) break
      pos += 1
    }
    end = Math.max(end, pos)
  }

  // Click-to-select can leave the caret ahead of the last suggestion range update.
  if (selection.empty && selection.to > end) {
    let pos = selection.to
    while (pos < scanEnd) {
      const ch = doc.textBetween(pos, pos + 1, '', '')
      if (!ch || !MENTION_QUERY_CHAR.test(ch)) break
      pos += 1
    }
    end = Math.max(end, pos)
  }

  return end
}

function mountPopup(
  popup: ReturnType<typeof createSuggestionPopup>,
  props: { editor: Editor; clientRect?: (() => DOMRect | null) | null },
  component: ReactRenderer<MentionListHandle, MentionListProps>
) {
  popup.ensure({
    clientRect: props.clientRect,
    content: component.element
  })
}

const suggestion = {
  command: ({
    editor,
    range,
    props
  }: {
    editor: Editor
    range: { from: number; to: number }
    props: { id: string | null; label?: string | null; mode?: PickerSearchMode }
  }) => {
    if (props.id === NEVENT_NADDR_PICKER_ID) {
      const to = extendMentionRangeToEndOfWord(editor, range)
      const insertAt = range.from
      // Drop @naddr / @nevent trigger text so the suggestion session ends before the dialog opens.
      editor.chain().focus().deleteRange({ from: range.from, to }).run()
      postEditor.closeSuggestionPopup()
      window.dispatchEvent(
        new CustomEvent(OPEN_NEVENT_PICKER_EVENT, {
          detail: {
            editor,
            range: { from: insertAt, to: insertAt },
            initialMode: props.mode ?? 'nevent'
          }
        })
      )
      return
    }
    if (props.id == null) return
    const to = extendMentionRangeToEndOfWord(editor, range)
    const nodeAfter = editor.view.state.selection.$to.nodeAfter
    const overrideSpace = nodeAfter?.text?.startsWith(' ')
    const toWithSpace = overrideSpace ? to + 1 : to
    editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: toWithSpace }, [
        { type: MENTION_EXTENSION_NAME, attrs: { ...props, mentionSuggestionChar: MENTION_CHAR } },
        { type: 'text', text: ' ' }
      ])
      .run()
    editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd()
    postEditor.closeSuggestionPopup()
  },

  items: async ({ query }: { query: string }) => {
    const q = query.trim().toLowerCase()
    if (q === 'nevent' || q === 'naddr' || q.startsWith('nevent') || q.startsWith('naddr')) {
      const mode: PickerSearchMode = q === 'naddr' || q.startsWith('naddr') ? 'naddr' : 'nevent'
      return [{ id: NEVENT_NADDR_PICKER_ID, mode }]
    }

    const generation = ++mentionSearchGeneration
    currentQuery = q

    const updateComponent = (npubs: string[]) => {
      if (generation !== mentionSearchGeneration || currentQuery !== q) return
      if (currentComponent) {
        currentComponent.updateProps({ items: npubs, loading: false })
      }
    }

    if (currentComponent) {
      currentComponent.updateProps({ items: [], loading: true })
    }

    try {
      const results = await searchNpubsForMention(query, MENTION_NPUB_DROPDOWN_LIMIT, updateComponent)
      if (generation === mentionSearchGeneration) {
        currentComponent?.updateProps({ items: results ?? [], loading: false })
        return results ?? []
      }
      return []
    } catch {
      if (generation === mentionSearchGeneration) {
        currentComponent?.updateProps({ items: [], loading: false })
      }
      return []
    }
  },

  render: () => {
    let component: ReactRenderer<MentionListHandle, MentionListProps> | undefined
    let popup: ReturnType<typeof createSuggestionPopup> | undefined
    let closePopup: (() => void) | undefined
    let exited = false

    const exit = () => {
      if (exited) return
      exited = true
      mentionSearchGeneration += 1
      postEditor.isSuggestionPopupOpen = false
      currentComponent = undefined
      currentQuery = ''
      popup?.destroy()
      popup = undefined
      component?.destroy()
      component = undefined
      if (closePopup) {
        postEditor.removeEventListener('closeSuggestionPopup', closePopup)
      }
    }

    return {
      onBeforeStart: () => {
        closePopup = exit
        postEditor.removeEventListener('closeSuggestionPopup', closePopup)
        postEditor.addEventListener('closeSuggestionPopup', closePopup)
      },
      onStart: (props: SuggestionProps<MentionListItem>) => {
        exited = false
        closePopup = exit
        postEditor.removeEventListener('closeSuggestionPopup', closePopup)
        postEditor.addEventListener('closeSuggestionPopup', closePopup)
        popup = createSuggestionPopup(props.editor)
        component = new ReactRenderer(MentionList, {
          props: { ...props, loading: true },
          editor: props.editor
        })
        currentComponent = component
        mountPopup(popup, props, component)
      },

      onUpdate(props: SuggestionProps<MentionListItem>) {
        if (exited) return
        component?.updateProps(props)
        if (popup && component) {
          mountPopup(popup, props, component)
        }
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          exit()
          return true
        }
        return component?.ref?.onKeyDown(props) ?? false
      },

      onExit() {
        exit()
      }
    }
  }
}

export default suggestion
