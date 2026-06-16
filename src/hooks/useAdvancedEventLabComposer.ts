import type { AdvancedLabBodyHandle } from '@/components/AdvancedEventLab/AdvancedEventLabDialog'
import type { TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'
import { isAsciidocMarkupKind } from '@/lib/advanced-event-lab-kinds'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import {
  formatLabInsertText,
  formatMarkupImageAppend
} from '@/lib/composer-markup-insert'
import { stripImwaldAttributionTags } from '@/lib/draft-event'
import postEditorCache from '@/services/post-editor-cache.service'
import type { TEmoji } from '@/types'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type ComposerBodyHandle = Pick<
  TPostTextareaHandle,
  'getText' | 'insertText' | 'insertEmoji' | 'appendText' | 'setDocumentFromPlainText'
>

export type UseAdvancedEventLabComposerOptions = {
  persistenceKey: string | null
  textareaRef: RefObject<TPostTextareaHandle | null>
  getKind: () => number
  /** Called synchronously when the lab opens or closes (before React state commits). */
  onOpenChange?: (open: boolean) => void
}

export function useAdvancedEventLabComposer({
  persistenceKey,
  textareaRef,
  getKind,
  onOpenChange
}: UseAdvancedEventLabComposerOptions) {
  const getKindRef = useRef(getKind)
  getKindRef.current = getKind

  const [advancedLabOpen, setAdvancedLabOpen] = useState(false)
  const advancedLabOpenRef = useRef(false)
  useEffect(() => {
    advancedLabOpenRef.current = advancedLabOpen
  }, [advancedLabOpen])

  const advancedLabBodyApiRef = useRef<AdvancedLabBodyHandle | null>(null)
  const [advancedLabInitial, setAdvancedLabInitial] = useState<AdvancedEventLabSlice | null>(null)

  const getActiveComposerBody = useCallback((): ComposerBodyHandle | AdvancedLabBodyHandle | null => {
    if (advancedLabOpenRef.current && advancedLabBodyApiRef.current) {
      return advancedLabBodyApiRef.current
    }
    return textareaRef.current
  }, [textareaRef])

  const normalizeSliceTags = useCallback((tags: string[][]) => {
    return stripImwaldAttributionTags(tags).map((row) => [...row])
  }, [])

  const resolveSliceForOpen = useCallback(
    (live: AdvancedEventLabSlice): AdvancedEventLabSlice => {
      const saved = persistenceKey ? postEditorCache.getAdvancedLabDraft(persistenceKey) : undefined
      const useSaved = !live.content.trim() && saved && saved.kind === live.kind
      if (useSaved) {
        return {
          kind: saved.kind,
          content: saved.content,
          tags: normalizeSliceTags(saved.tags)
        }
      }
      return {
        kind: live.kind,
        content: live.content,
        tags: normalizeSliceTags(live.tags)
      }
    },
    [persistenceKey, normalizeSliceTags]
  )

  const openLab = useCallback(
    (live: AdvancedEventLabSlice) => {
      const slice = resolveSliceForOpen(live)
      onOpenChange?.(true)
      setAdvancedLabInitial(slice)
      setAdvancedLabOpen(true)
    },
    [resolveSliceForOpen, onOpenChange]
  )

  const persistLabDraft = useCallback(
    (payload: AdvancedEventLabSlice) => {
      if (!persistenceKey) return
      postEditorCache.setAdvancedLabDraft(persistenceKey, {
        kind: payload.kind,
        content: payload.content,
        tags: payload.tags.map((r) => [...r])
      })
      postEditorCache.flushPersist()
    },
    [persistenceKey]
  )

  const applyToTipTap = useCallback(
    (plain: string) => {
      textareaRef.current?.setDocumentFromPlainText(plain)
    },
    [textareaRef]
  )

  const handleLabOpenChange = useCallback(
    (open: boolean, onClose?: () => void) => {
      onOpenChange?.(open)
      setAdvancedLabOpen(open)
      if (!open) {
        setAdvancedLabInitial(null)
        onClose?.()
      }
    },
    [onOpenChange]
  )

  const insertComposerText = useCallback(
    (txt: string) => {
      const lab = advancedLabOpenRef.current ? advancedLabBodyApiRef.current : null
      if (lab) {
        lab.insertText(formatLabInsertText(txt, isAsciidocMarkupKind(getKindRef.current())))
        return
      }
      textareaRef.current?.insertText(txt)
    },
    [textareaRef]
  )

  const insertComposerEmoji = useCallback(
    (em: string | TEmoji) => {
      getActiveComposerBody()?.insertEmoji(em)
    },
    [getActiveComposerBody]
  )

  const appendUploadedUrl = useCallback(
    (url: string, treatAsImage: boolean) => {
      const ed = getActiveComposerBody()
      if (!ed || ed.getText().includes(url)) return
      if (ed === advancedLabBodyApiRef.current && treatAsImage) {
        ed.appendText(formatMarkupImageAppend(url, isAsciidocMarkupKind(getKindRef.current())), false)
        return
      }
      ed.appendText(url, true)
    },
    [getActiveComposerBody]
  )

  return {
    advancedLabOpen,
    advancedLabOpenRef,
    advancedLabBodyApiRef,
    advancedLabInitial,
    getActiveComposerBody,
    openLab,
    persistLabDraft,
    applyToTipTap,
    handleLabOpenChange,
    insertComposerText,
    insertComposerEmoji,
    appendUploadedUrl
  }
}
