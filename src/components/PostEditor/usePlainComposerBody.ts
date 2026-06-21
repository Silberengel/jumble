import type { TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'
import type { ComposerBodyHandle } from '@/hooks/useAdvancedEventLabComposer'
import type { TEmoji } from '@/types'
import { useCallback, type RefObject } from 'react'

/** TipTap-only inserts when the advanced lab is not mounted (mobile / reply / other editors). */
export function usePlainComposerBody(textareaRef: RefObject<TPostTextareaHandle | null>) {
  const insertComposerText = useCallback(
    (txt: string) => {
      textareaRef.current?.insertText(txt)
    },
    [textareaRef]
  )

  const insertComposerEmoji = useCallback(
    (em: string | TEmoji) => {
      textareaRef.current?.insertEmoji(em)
    },
    [textareaRef]
  )

  const appendUploadedUrl = useCallback(
    (url: string, _treatAsImage: boolean) => {
      const ed = textareaRef.current as ComposerBodyHandle | null
      if (!ed || ed.getText().includes(url)) return
      ed.appendText(url, true)
    },
    [textareaRef]
  )

  return { insertComposerText, insertComposerEmoji, appendUploadedUrl }
}
