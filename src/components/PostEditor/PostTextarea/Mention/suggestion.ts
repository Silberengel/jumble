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

/** Extend range.to to include any trailing word chars (handle, NIP-05) so the full @handle is replaced. Exported for nevent picker. */
export function extendMentionRangeToEndOfWord(editor: Editor, range: { from: number; to: number }): number {
  const { doc } = editor.state
  let pos = range.to
  while (pos < doc.content.size) {
    const $pos = doc.resolve(pos)
    const node = $pos.nodeAfter
    if (!node || !node.isText) break
    const text = node.text ?? ''
    const offset = pos - $pos.start()
    let i = offset
    while (i < text.length && /[\w.-]/.test(text[i]!)) i++
    if (i === offset) break
    pos += i - offset
  }
  return pos
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
      postEditor.closeSuggestionPopup()
      window.dispatchEvent(
        new CustomEvent(OPEN_NEVENT_PICKER_EVENT, {
          detail: { editor, range, initialMode: props.mode ?? 'nevent' }
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
    let closePopup: () => void
    let exited = false

    return {
      onBeforeStart: () => {
        closePopup = () => {
          popup?.hide()
        }
        postEditor.addEventListener('closeSuggestionPopup', closePopup)
      },
      onStart: (props: SuggestionProps<MentionListItem>) => {
        popup = createSuggestionPopup(props.editor)
        component = new ReactRenderer(MentionList, {
          props: { ...props, loading: true },
          editor: props.editor
        })
        currentComponent = component
        mountPopup(popup, props, component)
      },

      onUpdate(props: SuggestionProps<MentionListItem>) {
        component?.updateProps(props)
        if (popup && component) {
          mountPopup(popup, props, component)
        }
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          popup?.hide()
          return true
        }
        return component?.ref?.onKeyDown(props) ?? false
      },

      onExit() {
        if (exited) return
        exited = true
        postEditor.isSuggestionPopupOpen = false
        currentComponent = undefined
        currentQuery = ''
        popup?.destroy()
        popup = undefined
        component?.destroy()
        component = undefined
        postEditor.removeEventListener('closeSuggestionPopup', closePopup)
      }
    }
  }
}

export default suggestion
