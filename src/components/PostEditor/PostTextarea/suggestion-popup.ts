import postEditor from '@/services/post-editor.service'
import type { Editor } from '@tiptap/core'
import tippy, { type GetReferenceClientRect, type Instance, type Props } from 'tippy.js'

/** Above Radix Sheet/Dialog (`z-50`) so @-mention / emoji lists stay visible on mobile. */
export const SUGGESTION_POPUP_Z_INDEX = 350

export type SuggestionPopupController = {
  ensure: (props: {
    clientRect?: (() => DOMRect | null) | null
    content: Element
  }) => void
  hide: () => void
  destroy: () => void
}

export function createSuggestionPopup(editor: Editor): SuggestionPopupController {
  let popup: Instance | undefined
  let touchListener: ((e: TouchEvent) => void) | undefined

  const destroy = () => {
    if (touchListener) {
      document.removeEventListener('touchstart', touchListener)
      touchListener = undefined
    }
    if (popup) {
      popup.destroy()
      popup = undefined
    }
    postEditor.isSuggestionPopupOpen = false
  }

  const ensure = (props: {
    clientRect?: (() => DOMRect | null) | null
    content: Element
  }) => {
    if (!props.clientRect) return

    if (!touchListener) {
      touchListener = (e: TouchEvent) => {
        if (!popup || !postEditor.isSuggestionPopupOpen) return
        const target = e.target as Node
        if (popup.popper?.contains(target)) return
        const editorEl = editor.view?.dom
        if (editorEl?.contains(target)) return
        popup.hide()
      }
      document.addEventListener('touchstart', touchListener, { passive: true })
    }

    const rectProps = {
      getReferenceClientRect: props.clientRect as GetReferenceClientRect
    }

    if (popup) {
      popup.setProps({
        ...rectProps,
        content: props.content
      } as Partial<Props>)
      if (!popup.state.isVisible) popup.show()
      return
    }

    popup = tippy(document.body, {
      ...rectProps,
      appendTo: () => document.body,
      content: props.content,
      showOnCreate: true,
      interactive: true,
      trigger: 'manual',
      placement: 'bottom-start',
      hideOnClick: false,
      maxWidth: 'none',
      zIndex: SUGGESTION_POPUP_Z_INDEX,
      touch: true,
      onShow() {
        postEditor.isSuggestionPopupOpen = true
      },
      onHide() {
        postEditor.isSuggestionPopupOpen = false
      }
    })
  }

  return {
    ensure,
    hide: () => popup?.hide(),
    destroy
  }
}
